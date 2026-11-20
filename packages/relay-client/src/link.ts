/**
 * Device-side relay client: a Link-shaped transport over the relay
 * WebSocket (`wss://<relay>/connect?account=…`, token-first-message auth).
 * Used by the CLI, the Electron main process and later the web leader
 * tab — anywhere a global `WebSocket` exists.
 */
import { newId, parseWireFrame, type Frame } from '@ormicode/protocol';

export interface RemoteEndpoint { relayUrl: string; account: string; device: string; token: string }

export class RelayAuthError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(code === 4001 ? 'device token revoked' : 'unknown device token');
    this.name = 'RelayAuthError';
    this.code = code;
  }
}

/** Exchange a live pairing code for a device token (HTTPS POST to the relay). */
export async function joinRemote(relayUrl: string, account: string, code: string, name: string): Promise<{ device: string; token: string }> {
  const res = await fetch(`${relayUrl.replace(/\/$/, '')}/join?account=${encodeURIComponent(account)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name }),
  });
  const body = await res.json() as { device?: string; token?: string; error?: string };
  if (!res.ok || !body.device || !body.token) throw new Error(body.error ?? `join failed (${res.status})`);
  return { device: body.device, token: body.token };
}

/** Link-shaped client over a relay WebSocket: JSON messages, same frame rules. */
export class WsLink {
  private ws: WebSocket;
  private queue: Frame[] = [];
  private waiting: ((frame: Frame | undefined) => void) | undefined;
  private pending = new Map<string, { resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private lastSeq = new Map<string, number>(); // dedupe DO-outbox vs hub-journal replays
  private subscriptions = new Map<string, number>();
  private replays = new Map<string, Promise<Frame>>();
  private gaps = new Map<string, Map<number, Frame>>();
  lastSub: { session: string; after: number } | undefined; // last subscribe for resync replay
  closed = false;
  closeCode?: number;
  private _onFrame: ((frame: Frame) => void) | undefined;
  /** Late-assigned handler drains frames queued before it was set (e.g. subscribe replay). */
  set onFrame(fn: ((frame: Frame) => void) | undefined) {
    this._onFrame = fn;
    while (fn && this.queue.length) fn(this.queue.shift()!);
  }
  get onFrame(): ((frame: Frame) => void) | undefined { return this._onFrame; }
  /** Non-protocol relay frames (e.g. `authed`) land here instead of the parser. */
  onRelayMessage: ((msg: Record<string, unknown>) => void) | undefined;
  onClose: (() => void) | undefined;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = e => this.feed(String(e.data));
    ws.onclose = event => {
      this.closed = true;
      this.closeCode = event.code;
      this.onClose?.();
      this.wake(undefined);
      const error = [4001, 4004].includes(event.code) ? new RelayAuthError(event.code) : new Error('relay connection closed');
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    };
    ws.onerror = () => { this.closed = true; };
  }

  send(frame: Frame | Record<string, unknown>): void {
    if (!this.closed) this.ws.send(JSON.stringify(frame));
  }

  request(method: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<Frame> {
    // Subscription state lives in the DO so it can filter fan-out and replay
    // the outbox; the protocol req still reaches the hub for bookkeeping.
    if (method === 'session.subscribe') {
      const session = String(body.session);
      const after = typeof body.after === 'number' ? body.after : 0;
      this.subscriptions.set(session, after);
      if (typeof body.after !== 'number' || !this.lastSeq.has(session)) {
        this.lastSeq.set(session, after);
        this.gaps.delete(session);
      }
      this.lastSub = { session, after };
      this.send({ type: 'subscribe', session: body.session, after: this.lastSub.after });
    }
    if (method === 'session.unsubscribe') {
      this.subscriptions.delete(String(body.session));
      this.lastSeq.delete(String(body.session));
      this.gaps.delete(String(body.session));
      this.send({ type: 'unsubscribe', session: body.session });
    }
    return this.requestHub(method, body, timeoutMs);
  }

  /** Recover directly from the hub without asking the bounded relay outbox again. */
  replay(session: string): Promise<Frame> | undefined {
    if (!this.subscriptions.has(session)) return undefined;
    const pending = this.replays.get(session);
    if (pending) return pending;
    const after = this.lastSeq.get(session) ?? this.subscriptions.get(session)!;
    const replay = this.requestHub('session.subscribe', { session, after }, 30_000);
    this.replays.set(session, replay);
    void replay.then(() => this.replays.delete(session), () => this.replays.delete(session));
    return replay;
  }

  private requestHub(method: string, body: Record<string, unknown>, timeoutMs: number): Promise<Frame> {
    const id = newId('req');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ v: 1, type: 'req', id, method, body, ts: Date.now() });
    });
  }

  private feed(raw: string): void {
    let msg: Record<string, unknown> | undefined;
    try { msg = JSON.parse(raw); } catch { /* fall through to protocol parse */ }
    if (msg && !['req', 'res', 'err', 'evt', 'ack', 'hello', 'idx', 'term'].includes(String(msg.type))) {
      this.onRelayMessage?.(msg);
      return;
    }
    const parsed = parseWireFrame(raw);
    if (!parsed.success) { this.wake(undefined); return; }
    const frame = parsed.data;
    if (frame.type === 'evt' && 'seq' in frame && typeof frame.seq === 'number') {
      const prev = this.lastSeq.get(frame.session) ?? 0;
      if (frame.seq <= prev) return; // already delivered via the other replay path
      if (this.subscriptions.has(frame.session) && frame.seq > prev + 1) {
        const pending = this.gaps.get(frame.session) ?? new Map<number, Frame>();
        pending.set(frame.seq, frame);
        this.gaps.set(frame.session, pending);
        void this.replay(frame.session)?.then(result => {
          if (result.type === 'err' && !this.closed) this.close();
        }, () => { if (!this.closed) this.close(); });
        return;
      }
      this.lastSeq.set(frame.session, frame.seq);
      this.deliver(frame);
      const pending = this.gaps.get(frame.session);
      let next = frame.seq + 1;
      while (pending?.has(next)) {
        const buffered = pending.get(next)!;
        pending.delete(next);
        this.lastSeq.set(frame.session, next++);
        this.deliver(buffered);
      }
      if (!pending?.size) this.gaps.delete(frame.session);
      return;
    }
    this.deliver(frame);
  }

  private deliver(frame: Frame): void {
    if ((frame.type === 'res' || frame.type === 'err') && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!;
      this.pending.delete(frame.id);
      clearTimeout(p.timer);
      p.resolve(frame);
      return;
    }
    if (this._onFrame) this._onFrame(frame); else this.wake(frame);
  }

  private wake(frame: Frame | undefined): void {
    const w = this.waiting;
    if (w) { this.waiting = undefined; w(frame); }
    else if (frame) this.queue.push(frame);
  }

  next(): Promise<Frame | undefined> {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.resolve(undefined);
    return new Promise(resolve => { this.waiting = resolve; });
  }

  close(): void { try { this.ws.close(); } catch { /* already closed */ } this.closed = true; }
}

/** Open a device socket to the relay and authenticate. */
export function connectRemote(config: RemoteEndpoint, onResyncError?: (msg: string) => void): Promise<WsLink> {
  return new Promise((resolve, reject) => {
    const url = `${config.relayUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/connect?account=${encodeURIComponent(config.account)}`;
    const ws = new WebSocket(url);
    const link = new WsLink(ws);
    ws.onopen = () => link.send({ type: 'auth', token: config.token });
    link.onClose = () => {
      if (link.closeCode === 4001 || link.closeCode === 4004) reject(new RelayAuthError(link.closeCode));
      else reject(new Error('relay connection closed'));
    };
    link.onRelayMessage = msg => {
      if (msg.type === 'authed') {
        link.send({ v: 1, type: 'hello', role: 'client', proto: 1, device: config.device });
        link.onRelayMessage = m => {
          if (m.type === 'resync') {
            const replay = link.replay(String(m.session));
            if (replay) void replay.then(frame => {
              if (frame.type === 'err') onResyncError?.(frame.code);
            }, error => onResyncError?.(String(error)));
            else onResyncError?.(`${m.session} too far behind — resync required`);
          } else if (m.type === 'err') onResyncError?.(`${m.code ?? 'error'}`);
        };
        resolve(link);
      }
    };
  });
}
