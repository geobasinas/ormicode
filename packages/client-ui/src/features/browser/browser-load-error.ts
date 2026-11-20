export type BrowserLoadError = {
  kind: 'unreachable' | 'invalid' | 'failed'; title: string; description: string; tabTitle: string; target: string; url?: string;
};

const CONNECTION = /ERR_(?:NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_\w+|ADDRESS_\w+|INTERNET_DISCONNECTED|EMPTY_RESPONSE|TIMED_OUT|NETWORK_\w+|PROXY_\w+|TUNNEL_CONNECTION_FAILED|DNS_\w+)/;
const INVALID = /ERR_INVALID_URL|ERR_DISALLOWED_URL_SCHEME|ERR_UNKNOWN_URL_SCHEME|Invalid (?:web )?address/i;
const NAVIGATION = /GUEST_VIEW_MANAGER_CALL|ERR_[A-Z_]+|Invalid (?:web )?address/i;

const messageOf = (source: unknown) => {
  if (source && typeof source === 'object' && 'errorCode' in source) return String((source as { errorDescription?: string }).errorDescription ?? '');
  return source instanceof Error ? source.message : String(source);
};

export function isLoadFailure(source: unknown) {
  return Boolean(source && typeof source === 'object' && 'errorCode' in source) || NAVIGATION.test(messageOf(source));
}

export function browserLoadError(source: unknown, fallbackUrl?: string): BrowserLoadError | undefined {
  const event = source && typeof source === 'object' && 'errorCode' in source ? source as { errorCode?: number; validatedURL?: string } : undefined;
  const message = messageOf(source);
  const code = event?.errorCode ?? Number(/\((-\d+)\)/.exec(message)?.[1]);
  if (code === -3 || /ERR_ABORTED/.test(message)) return;
  const url = event?.validatedURL || /loading '([^']+)'/.exec(message)?.[1] || fallbackUrl || undefined;
  let target = url ?? 'this address';
  try { if (url) target = new URL(url).host || url; } catch { target = url ?? target; }
  if (code === -300 || INVALID.test(message)) return { kind: 'invalid', title: "This address isn't valid", tabTitle: 'Invalid address', target: url ?? target, url,
    description: 'Check the address for typos, or enter search terms instead.' };
  if (CONNECTION.test(message)) return { kind: 'unreachable', title: "Can't reach this site", tabTitle: "Can't reach this site", target, url,
    description: 'The site may be down, or the address may be wrong. Check your connection and try again.' };
  return { kind: 'failed', title: "This page couldn't load", tabTitle: "Page didn't load", target, url,
    description: 'Something went wrong while opening this page. Try again in a moment.' };
}
