/**
 * Hub-side relay client. Keeps one outbound WebSocket to the account's
 * Durable Object, authenticates with the hub token, pushes journaled events
 * and device registry changes, and hands incoming device requests to the
 * supervisor through a RemoteLink (replies route back via the relay).
 */
import type { Frame } from '@ormicode/protocol';
import type { ClientLink } from './dispatch.ts';
import type { HubConfig } from './pair.ts';

export interface RelayHooks {
  /** A device join arrived over the relay; answer with pairResult. */
  onPairJoin(join: string, code: string, name: string): void;
  /** A remote device sent a request frame. */
  onRequest(link: ClientLink, frame: Frame): void;
  onState?(connected: boolean): void;
}

export class RemoteLink implements ClientLink {
  private relay: RelayClient;
  readonly device: string;
  constructor(relay: RelayClient, device: string) { this.relay = relay; this.device = device; }
  get closed(): boolean { return !this.relay.connected(); }
  send(frame: Frame | Record<string, unknown>): void { this.relay.send({ ...(frame as Record<string, unknown>), device: this.device }); }
  reply(id: string, body: Record<string, unknown>): void { this.send({ v: 1, type: 'res', id, ok: true, body }); }
  replyError(id: string, code: string, message: string): void { this.send({ v: 1, type: 'err', id, code, message }); }
  close(): void { /* the relay owns the socket */ }
}

export class RelayClient {
  private ws: WebSocket | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  lastError: string | undefined;

  private config: HubConfig;
  private hooks: RelayHooks;
  constructor(config: HubConfig, hooks: RelayHooks) { this.config = config; this.hooks = hooks; }

  start(): void { this.connect(); }

  private connect(): void {
    if (this.stopped) return;
    try {
      const url = `${this.config.relayUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/connect?account=${encodeURIComponent(this.config.account)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => { this.lastError = undefined; ws.send(JSON.stringify({ type: 'auth', token: this.config.token })); };
      ws.onmessage = e => this.onMessage(String(e.data));
      ws.onclose = () => { this.ws = undefined; this.hooks.onState?.(false); this.retry(); };
      ws.onerror = () => { this.lastError = 'relay socket error'; };
      // auth confirmation arrives as {type:'authed'}; state flips on first good frame
    } catch (e) { this.lastError = String(e); this.retry(); }
  }

  private retry(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, 5_000);
    this.timer.unref?.();
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'authed') { this.hooks.onState?.(true); return; }
    if (msg.type === 'pair.join') { this.hooks.onPairJoin(String(msg.join), String(msg.code), String(msg.name)); return; }
    if ((msg.type === 'req' || msg.type === 'evt' || msg.type === 'ack') && typeof msg.device === 'string') {
      const link = new RemoteLink(this, msg.device);
      const { device: _, ...frame } = msg;
      this.hooks.onRequest(link, frame as unknown as Frame);
    }
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** A journaled session event fanned out to subscribed devices. */
  sendEvt(session: string, seq: number, frame: Record<string, unknown>): void {
    this.send({ type: 'evt', session, seq, frame });
  }

  pairResult(join: string, result: { ok: true; device: string; name: string; tokenHash: string; token: string; codeHash: string } | { ok: false }): void {
    this.send({ type: 'pair.result', join, ...result });
  }

  deviceAdd(device: string, name: string, tokenHash: string): void {
    this.send({ type: 'device.add', device, name, tokenHash });
  }

  deviceRevoke(device: string): void {
    this.send({ type: 'device.revoke', device });
    // Also tell the relay over HTTP so revocation lands even if the socket is down.
    void fetch(`${this.config.relayUrl}/revoke`, {
      method: 'POST', headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    }).catch(() => undefined);
  }

  /** Register a live pairing code hash with the relay (HTTP, hub-token authed). */
  pushCode(codeHash: string, expiresAt: number): void {
    void fetch(`${this.config.relayUrl}/pair`, {
      method: 'POST', headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ codeHash, expiresAt }),
    }).catch(e => { this.lastError = String(e); });
  }

  connected(): boolean { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}
