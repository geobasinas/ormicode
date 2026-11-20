export type { ClientPlatform, DesktopExtras, ProtocolTransport, TokenStore } from './platform.ts';
export { isBrowserUrl, normalizeBrowserAddress } from './browser-address.ts';
export { electronPlatform } from './electron.ts';
export { browserPlatform, closeBrowserPlatform, resumeBrowserPlatform } from './browser.ts';
export type { WebDeps, WebPlatformOptions } from './browser.ts';
