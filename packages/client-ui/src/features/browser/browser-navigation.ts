import { normalizeBrowserAddress } from '@ormicode/client-platform';
import type { BrowserPage } from './browser-types.ts';

export function browserDestination(address: string, current?: BrowserPage, ports?: { base: number; count: number }) {
  const url = normalizeBrowserAddress(address, current?.port === undefined ? current?.path : current.url);
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (current?.port !== undefined && parsed.origin === new URL(current.url).origin) return { url, port: current.port, path };
  const port = Number(parsed.port);
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && ports && port >= ports.base && port < ports.base + ports.count)
    return { url, port, path };
  return { url, port: undefined, path: url };
}

export function browserLocation(url: string, initial: BrowserPage) {
  const parsed = new URL(url);
  const local = initial.port !== undefined && parsed.origin === new URL(initial.url).origin;
  return { path: local ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href, port: local ? initial.port : undefined };
}
