import { newId, PROTOCOL_VERSION, type Frame } from '@ormicode/protocol';
import { connectRemote, joinRemote, RelayAuthError } from '@ormicode/relay-client';
import type { RemoteEndpoint, WsLink } from '@ormicode/relay-client';
import type { WebRemote, WebStore } from './web-store.ts';

type Connect = typeof connectRemote;
type Join = typeof joinRemote;
type BroadcastMessage = { t: string; [key: string]: unknown };

export interface WebLeaderDeps {
  store: WebStore;
  locks: LockManager;
  channel: () => BroadcastChannel;
  connect?: Connect;
  join?: Join;
}

interface PendingRequest {
  resolve(frame: Frame): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class WebLeader {
  readonly channel: BroadcastChannel;
  onEvent: ((frame: Frame) => void) | undefined;
  private stateListener: ((state: string) => void) | undefined;
  private readonly tab = newId('d');
  private readonly connect: Connect;
  private readonly join: Join;
  private readonly relayUrl: string;
  private readonly deps: WebLeaderDeps;
  private readonly requests = new Map<string, PendingRequest>();
  private readonly localSubs = new Map<string, number>();
  private readonly subscribers = new Map<string, Map<string, number>>();
  private readonly upstreamSubs = new Set<string>();
  private link?: WsLink;
  private leader = false;
  private state = 'connecting';
  private lastOnlineAt?: number;
  private wakeLeader?: () => void;
  private readonly lockAbort = new AbortController();
  private reconfigure = false;

  set onState(listener: ((state: string) => void) | undefined) {
    this.stateListener = listener;
    if (listener) listener(this.state);
  }
  get onState(): ((state: string) => void) | undefined { return this.stateListener; }

  constructor(relayUrl: string, deps: WebLeaderDeps) {
    this.relayUrl = relayUrl;
    this.deps = deps;
    this.channel = deps.channel();
    this.connect = deps.connect ?? connectRemote;
    this.join = deps.join ?? joinRemote;
    this.channel.addEventListener('message', event => this.onMessage(event.data as BroadcastMessage));
    this.channel.postMessage({ t: 'hello' });
    void deps.locks.request('ormicode.relay', { signal: this.lockAbort.signal }, async () => {
      this.leader = true;
      this.channel.postMessage({ t: 'leader' });
      for (const [session, after] of this.localSubs) this.addSubscriber(this.tab, session, after);
      await this.runLeader();
    }).catch(() => undefined);
  }

  get lastOnline(): number | undefined { return this.lastOnlineAt; }
  get currentState(): string { return this.state; }

  close(): void {
    this.lockAbort.abort();
    if (this.leader) {
      this.leader = false;
      this.link?.close();
      this.upstreamSubs.clear();
      this.wakeLeader?.();
    } else this.channel.postMessage({ t: 'bye', tab: this.tab });
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('tab closed'));
    }
    this.requests.clear();
    this.channel.close();
  }

  request(method: string, body: Record<string, unknown> = {}): Promise<Frame> {
    if (this.leader) return this.link?.request(method, body) ?? Promise.resolve(this.offlineFrame(method));
    const id = newId('req');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`${method}: timed out`));
      }, 30_000);
      this.requests.set(id, { resolve, reject, timer });
      this.channel.postMessage({ t: 'req', id, method, body, tab: this.tab });
    });
  }

  subscribe(session: string, after = 0): void {
    this.localSubs.set(session, after);
    if (this.leader) this.addSubscriber(this.tab, session, after);
    else this.channel.postMessage({ t: 'sub', session, after, tab: this.tab });
  }

  unsubscribe(session: string): void {
    this.localSubs.delete(session);
    if (this.leader) this.removeSubscriber(this.tab, session);
    else this.channel.postMessage({ t: 'unsub', session, tab: this.tab });
  }

  async remote(): Promise<WebRemote | null> { return this.deps.store.getRemote(); }

  async pair(args: { account: string; code: string; name?: string }): Promise<{ device: string }> {
    const remote = await this.join(this.relayUrl, args.account, args.code, args.name ?? 'browser');
    const paired = { account: args.account, device: remote.device, name: args.name ?? 'browser' };
    await this.deps.store.setToken(remote.token);
    await this.deps.store.setRemote(paired);
    const message = { t: 'paired' };
    this.channel.postMessage(message);
    if (this.leader) this.handlePairChange();
    return { device: remote.device };
  }

  async unpair(): Promise<void> {
    await this.deps.store.clear();
    this.channel.postMessage({ t: 'unpaired' });
    if (this.leader) this.handlePairChange();
  }

  private setState(state: string): void {
    this.state = state;
    this.stateListener?.(state);
    this.channel.postMessage({ t: 'state', state, lastOnline: this.lastOnlineAt });
  }

  private onMessage(message: BroadcastMessage): void {
    switch (message.t) {
      case 'hello':
        if (this.leader) this.channel.postMessage({ t: 'state', state: this.state, lastOnline: this.lastOnlineAt });
        break;
      case 'leader':
        if (!this.leader) {
          this.channel.postMessage({ t: 'hello' });
          for (const [session, after] of this.localSubs) this.channel.postMessage({ t: 'sub', session, after, tab: this.tab });
        }
        break;
      case 'state':
        if (!this.leader && typeof message.state === 'string') {
          this.state = message.state;
          if (typeof message.lastOnline === 'number') this.lastOnlineAt = message.lastOnline;
          this.stateListener?.(this.state);
        }
        break;
      case 'evt':
        if (!this.leader && message.frame && (!message.tab || message.tab === this.tab)) this.onEvent?.(message.frame as Frame);
        break;
      case 'res': {
        if (this.leader || typeof message.id !== 'string' || !message.frame) break;
        const pending = this.requests.get(message.id);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.requests.delete(message.id);
        pending.resolve(message.frame as Frame);
        break;
      }
      case 'req':
        if (this.leader && typeof message.id === 'string' && typeof message.method === 'string')
          void this.answerRequest(message.id, message.method, message.body as Record<string, unknown> ?? {});
        break;
      case 'sub':
        if (this.leader && typeof message.tab === 'string' && typeof message.session === 'string')
          this.addSubscriber(message.tab, message.session, typeof message.after === 'number' ? message.after : 0);
        break;
      case 'unsub':
        if (this.leader && typeof message.tab === 'string' && typeof message.session === 'string')
          this.removeSubscriber(message.tab, message.session);
        break;
      case 'bye':
        if (this.leader && typeof message.tab === 'string') {
          for (const [session, tabs] of this.subscribers)
            if (tabs.has(message.tab)) this.removeSubscriber(message.tab, session);
        }
        break;
      case 'paired':
      case 'unpaired':
        if (this.leader) this.handlePairChange();
        break;
    }
  }

  private async answerRequest(id: string, method: string, body: Record<string, unknown>): Promise<void> {
    let frame: Frame;
    try {
      const response = await this.link?.request(method, body) ?? this.offlineFrame(method);
      frame = { ...response, id } as Frame;
    }
    catch (error) {
      frame = { v: 1, type: 'err', id, code: 'daemon.error', message: String(error) };
    }
    this.channel.postMessage({ t: 'res', id, frame });
  }

  private addSubscriber(tab: string, session: string, after: number): void {
    const tabs = this.subscribers.get(session) ?? new Map<string, number>();
    if (tabs.has(tab)) return;
    tabs.set(tab, after);
    this.subscribers.set(session, tabs);
    this.subscribeUpstream(session, after, true);
  }

  private removeSubscriber(tab: string, session: string): void {
    const tabs = this.subscribers.get(session);
    if (!tabs?.delete(tab)) return;
    if (tabs.size === 0) {
      this.subscribers.delete(session);
      if (this.upstreamSubs.delete(session)) void this.link?.request('session.unsubscribe', { session }).catch(() => undefined);
    }
  }

  private subscribeUpstream(session: string, after: number, replay = false): void {
    const link = this.link;
    if (!link || this.upstreamSubs.has(session) && !replay) return;
    this.upstreamSubs.add(session);
    void link.request('session.subscribe', { session, ...(after ? { after } : {}) }).catch(() => {
      if (this.link === link) this.upstreamSubs.delete(session);
    });
  }

  private handlePairChange(): void {
    this.reconfigure = true;
    this.link?.close();
    void Promise.all([this.deps.store.getToken(), this.deps.store.getRemote()]).then(([token, remote]) => {
      this.setState(token && remote ? 'connecting' : 'unpaired');
      this.wakeLeader?.();
    });
  }

  private async runLeader(): Promise<void> {
    let backoff = 1_000;
    while (this.leader) {
      const [token, remote] = await Promise.all([this.deps.store.getToken(), this.deps.store.getRemote()]);
      if (!token || !remote) {
        this.link = undefined;
        this.upstreamSubs.clear();
        this.setState('unpaired');
        await this.waitForWake();
        continue;
      }
      this.setState('connecting');
      let attempt: WsLink | undefined;
      try {
        this.reconfigure = false;
        const link = await this.connect({ relayUrl: this.relayUrl, account: remote.account, device: remote.device, token } satisfies RemoteEndpoint);
        attempt = link;
        if (!this.leader) { link.close(); return; }
        this.link = link;
        link.onFrame = frame => {
          if (frame.type === 'evt' && typeof frame.seq === 'number') {
            for (const [tab, after] of this.subscribers.get(frame.session) ?? []) {
              if (frame.seq <= after) continue;
              this.subscribers.get(frame.session)!.set(tab, frame.seq);
              if (tab === this.tab) this.onEvent?.(frame);
              else this.channel.postMessage({ t: 'evt', tab, frame });
            }
            return;
          }
          this.onEvent?.(frame);
          this.channel.postMessage({ t: 'evt', frame });
        };
        let closed: (code?: number) => void = () => undefined;
        link.onClose = () => closed(link.closeCode);
        const closedPromise = new Promise<void>(resolve => { closed = () => resolve(); });
        this.lastOnlineAt = Date.now();
        this.setState('online');
        const status = await link.request('daemon.status', {});
        if (status.type !== 'res') this.setState('protocol-old-hub');
        else {
        const proto = (status.body as { proto?: unknown }).proto;
        this.setState(typeof proto !== 'number' || proto < PROTOCOL_VERSION ? 'protocol-old-hub'
          : proto > PROTOCOL_VERSION ? 'protocol-old-client' : 'online');
        }
        for (const [session, tabs] of this.subscribers) {
          const after = tabs.values().next().value as number | undefined;
          this.subscribeUpstream(session, after ?? 0);
        }
        await Promise.race([closedPromise, this.waitForWake()]);
        this.link = undefined;
        this.upstreamSubs.clear();
        if (!this.leader) break;
        if (this.reconfigure) {
          this.reconfigure = false;
          const [nextToken, nextRemote] = await Promise.all([this.deps.store.getToken(), this.deps.store.getRemote()]);
          if (!nextToken || !nextRemote) this.setState('unpaired');
          continue;
        }
        if (link.closeCode === 4001 || link.closeCode === 4004) {
          await this.deps.store.clear();
          this.setState('unpaired');
          continue;
        }
        this.setState('offline');
        await this.waitForDelay(backoff);
        backoff = Math.min(backoff * 2, 15_000);
      } catch (error) {
        attempt?.close();
        this.link = undefined;
        this.upstreamSubs.clear();
        if (!this.leader) return;
        if (this.reconfigure) {
          this.reconfigure = false;
          const [nextToken, nextRemote] = await Promise.all([this.deps.store.getToken(), this.deps.store.getRemote()]);
          if (!nextToken || !nextRemote) this.setState('unpaired');
          continue;
        }
        if (error instanceof RelayAuthError || (error && typeof error === 'object' && 'code' in error && [4001, 4004].includes(Number(error.code)))) {
          await this.deps.store.clear();
          this.setState('unpaired');
          await this.waitForWake();
        } else {
          this.setState('offline');
          await this.waitForDelay(backoff);
          backoff = Math.min(backoff * 2, 15_000);
        }
      }
    }
  }

  private waitForWake(): Promise<void> {
    return new Promise(resolve => { this.wakeLeader = resolve; });
  }

  private waitForDelay(ms: number): Promise<void> {
    return Promise.race([
      new Promise<void>(resolve => setTimeout(resolve, ms)),
      this.waitForWake(),
    ]);
  }

  private offlineFrame(method: string): Frame {
    return { v: 1, type: 'err', id: newId('req'), code: 'daemon.offline', message: `${method}: relay unavailable` };
  }
}
