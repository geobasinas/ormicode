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
  subscribeEvents(listener: (frame: Frame) => void): () => void;
  /** 'connecting' | 'online' | 'offline' | 'unpaired' */
  onState: ((state: string) => void) | undefined;
}

/** Desktop-only extras, exposed by the Electron preload bridge. */
export interface DesktopExtras {
  /** safeStorage backend — 'basic_text' means no OS keyring (warn the user). */
  storageBackend(): string;
  /** Paired relay endpoint without the token, or null when unpaired. */
  remote(): { relayUrl: string; account: string; device: string; name: string; active?: boolean } | null;
  /** True while this window is connected to its local daemon socket. */
  linkIsLocal(): boolean;
  pair(args: { relay: string; account: string; code: string; name?: string }): Promise<{ device: string }>;
  unpair(): Promise<void>;
  /** Frameless-window controls (desktop draws its own titlebar). */
  winMin(): void;
  winMax(): void;
  winClose(): void;
  openPath(absPath: string): Promise<string>;
  showItemInFolder(absPath: string): void;
  /** Native folder picker for the project chip; null when cancelled. */
  pickFolder(): Promise<string | null>;
  layoutRead(): Promise<{ descriptor: unknown | null; errors: string[] }>;
  layoutWrite(descriptor: unknown): Promise<void>;
  openExternal(url: string): Promise<void>;
  previewClearData(partition: string): Promise<void>;
  /** Tell Chromium the persisted theme so `prefers-color-scheme` matches the window. */
  setTheme?(theme: 'light' | 'dark'): void;
}

export interface WebExtras {
  relayUrl: string;
  version: string;
  commit: string;
  remote(): Promise<{ account: string; device: string; name: string } | null>;
  pair(args: { account: string; code: string; name?: string }): Promise<{ device: string }>;
  unpair(): Promise<void>;
  lastOnline(): number | undefined;
}

export interface ClientPlatform {
  readonly kind: 'desktop' | 'web';
  readonly transport: ProtocolTransport;
  readonly tokens: TokenStore;
  /** Human-readable hub address for status surfaces. */
  readonly hubLabel: string;
  readonly desktop?: DesktopExtras;
  readonly web?: WebExtras;
}
