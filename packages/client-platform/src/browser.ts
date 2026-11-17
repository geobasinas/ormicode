/**
 * Web shell platform: a `ProtocolTransport` over the relay WebSocket with
 * the device token in IndexedDB. The web app is `next` after desktop —
 * this file is the seam, not the implementation yet.
 */
import type { ClientPlatform, ProtocolTransport, TokenStore } from './platform.ts';

export interface WebPlatformOptions { relay: string; account: string }

export function browserPlatform(_opts: WebPlatformOptions): ClientPlatform {
  const transport: ProtocolTransport = {
    request: () => Promise.reject(new Error('web platform not implemented yet')),
    subscribe: () => { throw new Error('web platform not implemented yet'); },
    unsubscribe: () => undefined,
    onEvent: undefined, onState: undefined,
  };
  const tokens: TokenStore = {
    get: () => Promise.resolve(undefined),
    set: () => Promise.reject(new Error('web token store not implemented yet')),
    clear: () => Promise.resolve(),
  };
  return { kind: 'web', transport, tokens, hubLabel: _opts.relay };
}
