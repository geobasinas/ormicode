// terminal.* methods: forwards to the pty broker over one broker connection
// per client, so broker attach/replay semantics carry through unchanged.
import { ensureBroker, brokerSocketPath, type BrokerClient } from '@ormicode/pty-broker';
import { ormicodeDir } from './socket.ts';
import type { Client } from './dispatch.ts';
import { getSession, getSessionPorts, type Store } from '@ormicode/session-store';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allocateSessionPorts } from './session-ports.ts';
import { environmentForSession } from './session-env.ts';

interface TerminalMeta { terminal: string; device: string; cwd: string; shell: string; session?: string; closed: boolean }

export class TerminalHub {
  private readonly conns = new Map<Client, Promise<BrokerClient>>();
  private readonly meta = new Map<string, TerminalMeta>();
  private readonly output = new Map<string, string>();
  private readonly auditPath: string;
  private readonly record: (session: string, kind: string, payload: Record<string, unknown>) => void;
  constructor(record: (session: string, kind: string, payload: Record<string, unknown>) => void, home: string) {
    this.record = record;
    this.auditPath = join(home, 'logs', 'terminal-audit.jsonl');
    if (existsSync(this.auditPath)) {
      try {
        for (const line of readFileSync(this.auditPath, 'utf8').trim().split('\n')) {
          if (!line) continue;
          const e = JSON.parse(line) as TerminalMeta & { event: string };
          if (e.event === 'open') this.meta.set(e.terminal, { terminal: e.terminal, device: e.device, cwd: e.cwd, shell: e.shell, ...(e.session ? { session: e.session } : {}), closed: false });
          if (e.event === 'close' || e.event === 'exit') { const m = this.meta.get(e.terminal); if (m) m.closed = true; }
        }
      } catch { this.meta.clear(); }
    }
  }
  private audit(event: 'open' | 'close' | 'exit', meta: TerminalMeta, code?: number | null): void {
    mkdirSync(dirname(this.auditPath), { recursive: true });
    appendFileSync(this.auditPath, `${JSON.stringify({ ts: Date.now(), event, terminal: meta.terminal, device: meta.device, cwd: meta.cwd, shell: meta.shell, ...(meta.session ? { session: meta.session } : {}), ...(code === undefined ? {} : { code }) })}\n`, { mode: 0o600 });
  }
  private ended(meta: TerminalMeta, code?: number | null): void {
    if (!meta.closed && meta.session) this.record(meta.session, 'terminal_close', { terminal: meta.terminal, ...(code === undefined ? {} : { code }) });
    meta.closed = true;
  }
  readonly socketPath = brokerSocketPath(ormicodeDir());

  private conn(client: Client): Promise<BrokerClient> {
    let p = this.conns.get(client);
    if (!p) {
      p = ensureBroker(this.socketPath).then(b => {
        b.onEvent = e => {
          if (client.link.closed) return;
          if (e.ev === 'output') {
            const meta = this.meta.get(e.terminal);
            if (meta?.session) {
              const value = `${this.output.get(e.terminal) ?? ''}${Buffer.from(e.data ?? '', 'base64').toString('utf8')}`;
              this.output.set(e.terminal, value.split(/\r?\n/).slice(-200).join('\n'));
            }
          }
          if (e.ev === 'exit') {
            const meta = this.meta.get(e.terminal);
            if (meta) { this.audit('exit', meta, e.code); this.ended(meta, e.code); }
          }
          const body = e.ev === 'output' ? { kind: 'terminal_output', offset: e.offset ?? 0, data: e.data ?? '' } : { kind: 'terminal_exit', code: e.code ?? null };
          client.link.send({ v: 1, type: 'term', terminal: e.terminal, body });
        };
        b.onClose = () => this.conns.delete(client);
        return b;
      });
      p.catch(() => this.conns.delete(client));
      this.conns.set(client, p);
    }
    return p;
  }

  drop(client: Client): void { void this.conns.get(client)?.then(b => b.close(), () => undefined); this.conns.delete(client); }

  recentOutput(session: string, terminal?: string): { terminal: string; output: string } | undefined {
    const candidates = [...this.meta.values()].filter(meta =>
      meta.session === session && !meta.closed && (!terminal || meta.terminal === terminal));
    const latest = candidates.at(-1);
    return latest ? { terminal: latest.terminal, output: this.output.get(latest.terminal) ?? '' } : undefined;
  }

  /** Revoking a device kills its terminals immediately. */
  async killDevice(device: string): Promise<void> {
    const b = await ensureBroker(this.socketPath);
    await b.request('kill_device', { device }); b.close();
  }

  async open(db: Store, client: Client, id: string, body: Record<string, unknown>): Promise<void> {
    if (body.session) {
      const session = getSession(db, String(body.session));
      if (!session) return client.link.replyError(id, 'session.not_found', String(body.session));
      let base = getSessionPorts(db, session.id);
      try { base ??= (await allocateSessionPorts(db, session.id)).base; }
      catch (error) { return client.link.replyError(id, 'session.ports_unavailable', String(error)); }
      body = { ...body, ...(!body.cwd ? { cwd: session.cwd } : {}), env: environmentForSession(session, base) };
    }
    if (!body.cwd) return client.link.replyError(id, 'terminal.bad_request', 'provide cwd or session');
    return this.method(client, id, 'terminal.open', body);
  }

  async method(client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
    const op = method.slice('terminal.'.length);
    const b = await this.conn(client);
    const session = typeof body.session === 'string' ? body.session : undefined;
    const { session: _session, ...args } = body;
    const res = await b.request(op, op === 'open' ? { ...args, device: client.device, attach: false } : args);
    if (res.error) return client.link.replyError(id, res.error.code, res.error.message);
    const { id: _id, ok: _ok, ...rest } = res;
    if (op === 'open') {
      const info = rest as unknown as { terminal: string; cwd: string; shell: string; device: string };
      const meta: TerminalMeta = { terminal: info.terminal, cwd: info.cwd, shell: info.shell, device: info.device, ...(session ? { session } : {}), closed: false };
      this.meta.set(info.terminal, meta);
      this.audit('open', meta);
      if (session) this.record(session, 'terminal_open', { terminal: info.terminal, device: info.device, cwd: info.cwd, shell: info.shell });
      await b.request('attach', { terminal: info.terminal, from: 0 });
    }
    if (op === 'close') {
      const meta = this.meta.get(String(body.terminal));
      if (meta) { this.audit('close', meta); this.ended(meta); }
    }
    return client.link.reply(id, rest);
  }
}
