/// <reference types="@cloudflare/workers-types" />
/**
 * One AccountDO per ormicode account. Holds the hub socket, device sockets,
 * token hashes, pending pairing codes, per-device cursors and a bounded
 * per-session outbox in DO SQLite. Hibernation-friendly: per-socket state
 * lives in attachments, durable state in storage.
 */

interface Attachment { role: 'pending' | 'hub' | 'device'; device?: string }

const sha256hex = async (input: string): Promise<string> => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
};
const eq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const OUTBOX_CAP = 1000; // frames kept per session; deeper history comes from the hub
const JOIN_TTL_MS = 30_000;

export class AccountDO implements DurableObject {
  private joins = new Map<string, (res: Response) => void>();
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT, token_hash TEXT UNIQUE, revoked INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS codes(code_hash TEXT PRIMARY KEY, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS cursors(device TEXT, session TEXT, seq INTEGER, PRIMARY KEY(device, session));
      CREATE TABLE IF NOT EXISTS subs(device TEXT, session TEXT, PRIMARY KEY(device, session));
      CREATE TABLE IF NOT EXISTS outbox(session TEXT, seq INTEGER, frame TEXT, PRIMARY KEY(session, seq));
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, device TEXT);
    `);
  }

  private get sql() { return this.ctx.storage.sql; }
  private meta(key: string): string | undefined {
    return (this.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value) as string | undefined;
  }
  private sockets(role: Attachment['role'], device?: string): WebSocket[] {
    return this.ctx.getWebSockets().filter(ws => {
      const a = ws.deserializeAttachment() as Attachment | undefined;
      return a?.role === role && (!device || a.device === device);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/connect') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ role: 'pending' } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    // Token probes used by the worker for blob auth; never log the token.
    if (req.method === 'POST' && url.pathname === '/auth-hub') {
      const { token } = await req.json() as { token?: string };
      const ok = !!(token && this.meta('hub_token_hash') && eq(this.meta('hub_token_hash')!, await sha256hex(token)));
      return new Response(null, { status: ok ? 200 : 401 });
    }
    if (req.method === 'POST' && url.pathname === '/auth-any') {
      const { tokenHash } = await req.json() as { tokenHash?: string };
      const ok = !!(tokenHash && (eq(tokenHash, this.meta('hub_token_hash') ?? '') || this.deviceForHash(tokenHash)));
      return new Response(null, { status: ok ? 200 : 401 });
    }
    if (req.method === 'POST' && url.pathname === '/register') {
      const { hubTokenHash } = await req.json() as { hubTokenHash?: string };
      if (!hubTokenHash) return new Response('hubTokenHash required', { status: 400 });
      this.sql.exec('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', 'hub_token_hash', hubTokenHash);
      return Response.json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/pair') {
      if (!(await this.authed(req))) return new Response('unauthorized', { status: 401 });
      const { codeHash, expiresAt } = await req.json() as { codeHash?: string; expiresAt?: number };
      if (!codeHash || !expiresAt) return new Response('codeHash and expiresAt required', { status: 400 });
      this.sql.exec('INSERT OR REPLACE INTO codes(code_hash, expires_at) VALUES (?, ?)', codeHash, expiresAt);
      this.setAlarm();
      return Response.json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/join') return this.join(req);
    if (req.method === 'POST' && url.pathname === '/revoke') {
      if (!(await this.authed(req))) return new Response('unauthorized', { status: 401 });
      const { device } = await req.json() as { device?: string };
      if (!device) return new Response('device required', { status: 400 });
      this.sql.exec('UPDATE devices SET revoked = 1 WHERE id = ?', device);
      for (const ws of this.sockets('device', device)) ws.close(4001, 'revoked');
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }

  private async authed(req: Request): Promise<boolean> {
    const stored = this.meta('hub_token_hash');
    const bearer = req.headers.get('authorization')?.replace(/^bearer\s+/i, '');
    return !!(stored && bearer && eq(stored, await sha256hex(bearer)));
  }

  private async join(req: Request): Promise<Response> {
    const { code, name } = await req.json() as { code?: string; name?: string };
    if (!code || !name) return new Response('code and name required', { status: 400 });
    const hash = await sha256hex(code.replace(/\D/g, ''));
    const row = this.sql.exec('SELECT expires_at FROM codes WHERE code_hash = ?', hash).toArray()[0];
    if (!row || (row.expires_at as number) < Date.now()) return Response.json({ error: 'pairing.invalid_code' }, { status: 403 });
    const hub = this.sockets('hub')[0];
    if (!hub) return Response.json({ error: 'pairing.hub_offline' }, { status: 503 });
    const join = crypto.randomUUID();
    const done = new Promise<Response>(resolve => this.joins.set(join, resolve));
    const timeout = setTimeout(() => {
      const res = this.joins.get(join);
      if (res) { this.joins.delete(join); res(Response.json({ error: 'pairing.timeout' }, { status: 504 })); }
    }, JOIN_TTL_MS);
    try {
      hub.send(JSON.stringify({ type: 'pair.join', join, code: code.replace(/\s/g, ''), name }));
      return await done;
    } finally { clearTimeout(timeout); }
  }

  private setAlarm(): void {
    const next = this.sql.exec('SELECT MIN(expires_at) AS t FROM codes').one()?.t as number | undefined;
    if (next) void this.ctx.storage.setAlarm(next);
  }
  async alarm(): Promise<void> {
    this.sql.exec('DELETE FROM codes WHERE expires_at < ?', Date.now());
    this.setAlarm();
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
    catch { ws.close(4002, 'bad frame'); return; }
    const a = (ws.deserializeAttachment() ?? { role: 'pending' }) as Attachment;

    if (a.role === 'pending') {
      if (msg.type !== 'auth' || typeof msg.token !== 'string') { ws.close(4003, 'first frame must be auth'); return; }
      const hash = await sha256hex(msg.token);
      const next: Attachment = eq(hash, this.meta('hub_token_hash') ?? '') ? { role: 'hub' }
        : this.deviceForHash(hash) ? { role: 'device', device: this.deviceForHash(hash) } : { role: 'pending' };
      if (next.role === 'pending') { ws.close(4004, 'unknown token'); return; }
      ws.serializeAttachment(next);
      ws.send(JSON.stringify({ type: 'authed', role: next.role, ...(next.device ? { device: next.device } : {}) }));
      return;
    }

    if (a.role === 'device') { await this.deviceMessage(ws, a.device!, msg); return; }
    await this.hubMessage(ws, msg);
  }

  private deviceForHash(hash: string): string | undefined {
    return this.sql.exec('SELECT id FROM devices WHERE token_hash = ? AND revoked = 0', hash).toArray()[0]?.id as string | undefined;
  }

  private async deviceMessage(ws: WebSocket, device: string, msg: Record<string, unknown>): Promise<void> {
    const session = typeof msg.session === 'string' ? msg.session : '';
    switch (msg.type) {
      case 'subscribe': {
        if (!session) return;
        this.sql.exec('INSERT OR IGNORE INTO subs(device, session) VALUES (?, ?)', device, session);
        const after = typeof msg.after === 'number' ? msg.after : 0;
        this.sql.exec('INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)', device, session, after);
        for (const row of this.sql.exec('SELECT seq, frame FROM outbox WHERE session = ? AND seq > ? ORDER BY seq', session, after)) {
          ws.send(row.frame as string);
          this.sql.exec('INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)', device, session, row.seq as number);
        }
        return;
      }
      case 'unsubscribe':
        this.sql.exec('DELETE FROM subs WHERE device = ? AND session = ?', device, session);
        return;
      case 'ack':
        if (session && typeof msg.seq === 'number')
          this.sql.exec('INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)', device, session, msg.seq);
        return;
      case 'req': {
        const hub = this.sockets('hub')[0];
        if (!hub) { ws.send(JSON.stringify({ type: 'err', id: msg.id, code: 'relay.hub_offline' })); return; }
        this.sql.exec('INSERT OR REPLACE INTO requests(id, device) VALUES (?, ?)', String(msg.id), device);
        hub.send(JSON.stringify({ ...msg, device }));
        return;
      }
      default: return;
    }
  }

  private async hubMessage(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'evt': {
        const session = String(msg.session); const seq = Number(msg.seq);
        const frame = JSON.stringify(msg.frame ?? msg);
        this.sql.exec('INSERT OR REPLACE INTO outbox(session, seq, frame) VALUES (?, ?, ?)', session, seq, frame);
        this.sql.exec('DELETE FROM outbox WHERE session = ? AND seq <= ? - 5000', session, seq);
        for (const d of this.subscribed(session)) {
          for (const sock of this.sockets('device', d)) {
            try { sock.send(frame); this.sql.exec('INSERT OR REPLACE INTO cursors(device, session, seq) VALUES (?, ?, ?)', d, session, seq); }
            catch { /* dropped socket; cursor stays so it resyncs */ }
          }
        }
        return;
      }
      case 'res': case 'err': {
        const row = this.sql.exec('SELECT device FROM requests WHERE id = ?', String(msg.id)).toArray()[0];
        if (!row) return;
        this.sql.exec('DELETE FROM requests WHERE id = ?', String(msg.id));
        for (const sock of this.sockets('device', String(row.device))) sock.send(JSON.stringify(msg));
        return;
      }
      case 'pair.result': {
        const res = this.joins.get(String(msg.join));
        if (!res) return;
        this.joins.delete(String(msg.join));
        if (msg.ok && typeof msg.device === 'string' && typeof msg.tokenHash === 'string') {
          this.sql.exec('INSERT OR REPLACE INTO devices(id, name, token_hash) VALUES (?, ?, ?)',
            msg.device, String(msg.name ?? msg.device), msg.tokenHash);
          this.sql.exec('DELETE FROM codes WHERE code_hash = ?', String(msg.codeHash ?? ''));
          res(Response.json({ device: msg.device, token: msg.token }));
        } else res(Response.json({ error: 'pairing.rejected' }, { status: 403 }));
        return;
      }
      case 'device.add':
        this.sql.exec('INSERT OR REPLACE INTO devices(id, name, token_hash) VALUES (?, ?, ?)',
          String(msg.device), String(msg.name), String(msg.tokenHash));
        return;
      case 'device.revoke': {
        const id = String(msg.device);
        this.sql.exec('UPDATE devices SET revoked = 1 WHERE id = ?', id);
        for (const sock of this.sockets('device', id)) sock.close(4001, 'revoked');
        return;
      }
      default: return;
    }
  }

  private subscribed(session: string): string[] {
    return this.sql.exec('SELECT DISTINCT device FROM subs WHERE session = ?', session).toArray().map(r => r.device as string);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(1000); } catch { /* already closed */ }
  }
}
