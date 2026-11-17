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

/** Desktop-only extras, exposed by the Electron preload bridge. */
export interface DesktopExtras {
  /** safeStorage backend — 'basic_text' means no OS keyring (warn the user). */
  storageBackend(): string;
  /** Paired relay endpoint without the token, or null when unpaired. */
  remote(): { relayUrl: string; account: string; device: string; name: string } | null;
  pair(args: { relay: string; account: string; code: string; name?: string }): Promise<{ device: string }>;
  unpair(): Promise<void>;
  /** Frameless-window controls (desktop draws its own titlebar). */
  winMin(): void;
  winMax(): void;
  winClose(): void;
}

export interface ClientPlatform {
  readonly kind: 'desktop' | 'web';
  readonly transport: ProtocolTransport;
  readonly tokens: TokenStore;
  /** Human-readable hub address for status surfaces. */
  readonly hubLabel: string;
  readonly desktop?: DesktopExtras;
}
