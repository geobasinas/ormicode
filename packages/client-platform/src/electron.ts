/**
 * Desktop shell: the preload bridge exposes `window.ormi` (request,
 * subscribe, unsubscribe, onEvent, onState, token get/set/clear). This
 * adapts it to `ClientPlatform` — the renderer only sees the interface.
 */
import type { Frame } from '@ormicode/protocol';
import type { ClientPlatform, ProtocolTransport, TokenStore } from './platform.ts';

interface OrmiBridge {
  request(method: string, body?: Record<string, unknown>): Promise<Frame>;
  subscribe(session: string, after?: number): void;
  unsubscribe(session: string): void;
  onEvent(cb: (frame: Frame) => void): void;
  onState(cb: (state: string) => void): void;
  tokenGet(): Promise<string | undefined>;
  tokenSet(token: string): Promise<void>;
  tokenClear(): Promise<void>;
  pair(args: { relay: string; account: string; code: string; name?: string }): Promise<{ device: string }>;
  unpair(): Promise<void>;
  remote(): { relayUrl: string; account: string; device: string; name: string } | null;
  storageBackend(): string;
  hubLabel(): string;
  winMin(): void;
  winMax(): void;
  winClose(): void;
  openPath(absPath: string): Promise<string>;
  showItemInFolder(absPath: string): void;
  pickFolder(): Promise<string | null>;
  layoutRead(): Promise<{ descriptor: unknown | null; errors: string[] }>;
  layoutWrite(descriptor: unknown): Promise<void>;
}

declare global {
  interface Window { ormi?: OrmiBridge }
}

function bridge(): OrmiBridge {
  const b = window.ormi;
  if (!b) throw new Error('ormi preload bridge missing — is this running inside the desktop shell?');
  return b;
}

export function electronPlatform(): ClientPlatform {
  const b = bridge();
  const transport: ProtocolTransport = {
    request: (m, body) => b.request(m, body),
    subscribe: (s, after) => b.subscribe(s, after),
    unsubscribe: s => b.unsubscribe(s),
    onEvent: undefined, onState: undefined,
  };
  b.onEvent(frame => transport.onEvent?.(frame));
  b.onState(state => transport.onState?.(state));
  const tokens: TokenStore = {
    get: () => b.tokenGet(),
    set: t => b.tokenSet(t),
    clear: () => b.tokenClear(),
  };
  return {
    kind: 'desktop', transport, tokens, hubLabel: b.hubLabel(),
    desktop: {
      storageBackend: () => b.storageBackend(),
      remote: () => b.remote(),
      pair: args => b.pair(args),
      unpair: () => b.unpair(),
      winMin: () => b.winMin(),
      winMax: () => b.winMax(),
      winClose: () => b.winClose(),
      openPath: absPath => b.openPath(absPath),
      showItemInFolder: absPath => b.showItemInFolder(absPath),
      pickFolder: () => b.pickFolder(),
      layoutRead: () => b.layoutRead(),
      layoutWrite: descriptor => b.layoutWrite(descriptor),
    },
  };
}
