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

export function browserPlatform(opts: WebPlatformOptions): ClientPlatform {
  const store = opts.deps?.store ?? new IndexedDbWebStore();
  const leader = new WebLeader(opts.relay, {
    store,
    locks: opts.deps?.locks ?? navigator.locks,
    channel: opts.deps?.channel ?? (() => new BroadcastChannel('ormicode')),
    connect: opts.deps?.connect,
    join: opts.deps?.join,
  });
  let stateListener: ((state: string) => void) | undefined;
  const transport: ProtocolTransport = {
    request: (method, body) => leader.request(method, body),
    subscribe: (session, after) => leader.subscribe(session, after),
    unsubscribe: session => leader.unsubscribe(session),
    onEvent: undefined,
    get onState() { return stateListener; },
    set onState(listener) {
      stateListener = listener;
      if (listener) listener(leader.currentState);
    },
  };
  leader.onEvent = frame => transport.onEvent?.(frame);
  leader.onState = state => stateListener?.(state);
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
  return platform;
}

export function closeBrowserPlatform(platform: ClientPlatform): void {
  leaders.get(platform)?.close();
  leaders.delete(platform);
}
