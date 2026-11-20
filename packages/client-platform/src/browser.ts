import type { ClientPlatform, ProtocolTransport, TokenStore } from './platform.ts';
import { IndexedDbWebStore } from './web-store.ts';
import type { WebStore } from './web-store.ts';
import { WebLeader } from './web-leader.ts';
import type { WebLeaderDeps } from './web-leader.ts';

export interface WebDeps {
  store?: WebStore;
  locks?: LockManager;
  channel?: () => BroadcastChannel;
  connect?: WebLeaderDeps['connect'];
  join?: WebLeaderDeps['join'];
}

export interface WebPlatformOptions {
  relay: string;
  version: string;
  commit: string;
  deps?: WebDeps;
}

const leaders = new WeakMap<ClientPlatform, WebLeader>();
const resumes = new WeakMap<ClientPlatform, () => void>();

export function browserPlatform(opts: WebPlatformOptions): ClientPlatform {
  const store = opts.deps?.store ?? new IndexedDbWebStore();
  const createLeader = () => new WebLeader(opts.relay, {
    store,
    locks: opts.deps?.locks ?? navigator.locks,
    channel: opts.deps?.channel ?? (() => new BroadcastChannel('ormicode')),
    connect: opts.deps?.connect,
    join: opts.deps?.join,
  });
  let leader = createLeader();
  const subscriptions = new Map<string, number>();
  let stateListener: ((state: string) => void) | undefined;
  const listeners = new Set<(frame: import('@ormicode/protocol').Frame) => void>();
  const transport: ProtocolTransport = {
    request: (method, body) => leader.request(method, body),
    subscribe: (session, after = 0) => { subscriptions.set(session, after); leader.subscribe(session, after); },
    unsubscribe: session => { subscriptions.delete(session); leader.unsubscribe(session); },
    onEvent: undefined,
    get onState() { return stateListener; },
    set onState(listener) {
      stateListener = listener;
      if (listener) listener(leader.currentState);
    },
    subscribeEvents: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const listen = () => {
    leader.onEvent = frame => {
      if (frame.type === 'evt' && typeof frame.seq === 'number' && subscriptions.has(frame.session))
        subscriptions.set(frame.session, frame.seq);
      transport.onEvent?.(frame);
      for (const listener of listeners) listener(frame);
    };
    leader.onState = state => stateListener?.(state);
  };
  listen();
  const tokens: TokenStore = {
    get: async () => (await store.getToken()) ?? undefined,
    set: token => store.setToken(token),
    clear: () => store.clearToken(),
  };
  const platform: ClientPlatform = {
    kind: 'web',
    transport,
    tokens,
    hubLabel: opts.relay,
    web: {
      relayUrl: opts.relay,
      version: opts.version,
      commit: opts.commit,
      remote: () => leader.remote(),
      pair: args => leader.pair(args),
      unpair: () => leader.unpair(),
      lastOnline: () => leader.lastOnline,
    },
  };
  leaders.set(platform, leader);
  resumes.set(platform, () => {
    if (leaders.has(platform)) return;
    leader = createLeader();
    listen();
    for (const [session, after] of subscriptions) leader.subscribe(session, after);
    leaders.set(platform, leader);
  });
  return platform;
}

export function resumeBrowserPlatform(platform: ClientPlatform): void {
  resumes.get(platform)?.();
}

export function closeBrowserPlatform(platform: ClientPlatform): void {
  leaders.get(platform)?.close();
  leaders.delete(platform);
}
