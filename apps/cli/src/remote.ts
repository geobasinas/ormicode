/**
 * Remote hub access: ~/.ormicode/remote.json holds the paired device token.
 * Session commands transparently run over wss://<relay>/connect instead of the
 * local socket when that file exists (unless --local or ORMICODE_REMOTE=0).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { newId, parseWireFrame, type Frame } from '@ormicode/protocol';
import { ormicodeDir } from '@ormicode/daemon';

export interface RemoteConfig { relayUrl: string; account: string; device: string; token: string; name: string }

export function loadRemote(): RemoteConfig | undefined {
  try {
    const c = JSON.parse(readFileSync(join(ormicodeDir(), 'remote.json'), 'utf8')) as RemoteConfig;
    return c.relayUrl && c.account && c.device && c.token ? c : undefined;
  } catch { return undefined; }
}
export function saveRemote(c: RemoteConfig): void {
  writeFileSync(join(ormicodeDir(), 'remote.json'), JSON.stringify(c, null, 2), { mode: 0o600 });
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
  private pending = new Map<string, { resolve: (frame: Frame) => void; timer: NodeJS.Timeout }>();
  closed = false;
  onFrame: ((frame: Frame) => void) | undefined;
  /** Non-protocol relay frames (e.g. `authed`) land here instead of the parser. */
  onRelayMessage: ((msg: Record<string, unknown>) => void) | undefined;
  onClose: (() => void) | undefined;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = e => this.feed(String(e.data));
    ws.onclose = () => { this.closed = true; this.onClose?.(); this.wake(undefined); };
    ws.onerror = () => { this.closed = true; };
  }

  send(frame: Frame | Record<string, unknown>): void {
    if (!this.closed) this.ws.send(JSON.stringify(frame));
  }

  request(method: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<Frame> {
    const id = newId('req');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.send({ v: 1, type: 'req', id, method, body, ts: Date.now() });
    });
  }

  private feed(raw: string): void {
    let msg: Record<string, unknown> | undefined;
    try { msg = JSON.parse(raw); } catch { /* fall through to protocol parse */ }
    if (msg && !['req', 'res', 'err', 'evt', 'ack', 'hello', 'idx'].includes(String(msg.type))) {
      this.onRelayMessage?.(msg);
      return;
    }
    const parsed = parseWireFrame(raw);
    if (!parsed.success) { this.wake(undefined); return; }
    const frame = parsed.data;
    if ((frame.type === 'res' || frame.type === 'err') && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!;
      this.pending.delete(frame.id);
      clearTimeout(p.timer);
      p.resolve(frame);
      return;
    }
    if (this.onFrame) this.onFrame(frame); else this.wake(frame);
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
export function connectRemote(config: RemoteConfig): Promise<WsLink> {
  return new Promise((resolve, reject) => {
    const url = `${config.relayUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/connect?account=${encodeURIComponent(config.account)}`;
    const ws = new WebSocket(url);
    const link = new WsLink(ws);
    ws.onopen = () => link.send({ type: 'auth', token: config.token });
    ws.onclose = () => reject(new Error('relay connection closed'));
    link.onRelayMessage = msg => {
      if (msg.type === 'authed') {
        link.send({ v: 1, type: 'hello', role: 'client', proto: 1, device: config.device });
        link.onRelayMessage = undefined;
        resolve(link);
      }
    };
  });
}
