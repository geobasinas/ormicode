export function isBrowserUrl(value: unknown): value is string {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; }
  catch { return false; }
}

export function normalizeBrowserAddress(input: string, base?: string): string {
  const text = input.trim();
  if (!text) throw new Error('Enter a URL or search terms.');
  if (/[\u0000-\u001f\u007f\\]/.test(text)) throw new Error('Invalid address.');
  let candidate: string;
  const hostPort = /^(?:localhost|[\w.-]+\.[\w-]+|\[[\da-f:]+\]):\d+(?:[/?#]|$)/i.test(text);
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !hostPort) {
    if (!/^https?:/i.test(text)) throw new Error('Only HTTP and HTTPS addresses are allowed.');
    candidate = text;
  } else if (text.startsWith('//')) candidate = `https:${text}`;
  else if (/^[/?#]/.test(text)) {
    if (!base || !isBrowserUrl(base)) throw new Error('Open a page before entering a relative path.');
    candidate = new URL(text, base).href;
  } else if (!/\s/.test(text) && /^(?:localhost(?=[:/?#]|$)|\[[\da-f:]+\]|[^/?#]+\.[^/?#]+)/i.test(text)) candidate = `https://${text}`;
  else candidate = `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('Invalid web address.'); }
  if (!isBrowserUrl(url.href)) throw new Error('Only HTTP and HTTPS addresses are allowed.');
  return url.href;
}
