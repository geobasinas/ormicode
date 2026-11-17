/**
 * The platform boundary every client shell hands to `client-ui`. The
 * renderer never sees a socket, a file path or a token — it gets a
 * `ClientPlatform` and talks protocol methods only.
 */
import type { Frame } from '@ormicode/protocol';

/** Where the device token lives. Desktop: Electron safeStorage; web: IndexedDB. */
export interface TokenStore {
  get(): Promise<string | undefined>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** The only way the UI reaches the hub. Implemented per shell. */
export interface ProtocolTransport {
  request(method: string, body?: Record<string, unknown>): Promise<Frame>;
  subscribe(session: string, after?: number): void;
  unsubscribe(session: string): void;
  onEvent: ((frame: Frame) => void) | undefined;
  /** 'connecting' | 'online' | 'offline' | 'unpaired' */
  onState: ((state: string) => void) | undefined;
}

export interface ClientPlatform {
  readonly kind: 'desktop' | 'web';
  readonly transport: ProtocolTransport;
  readonly tokens: TokenStore;
  /** Human-readable hub address for status surfaces. */
  readonly hubLabel: string;
}
