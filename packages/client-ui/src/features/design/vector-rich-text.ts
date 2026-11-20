import { sanitizeMarkup } from './sanitize.ts';

export const MAX_RICH_MARKUP = 8192;
export const RICH_CLASS = 'ormi-rich-text';
export const RICH_STYLES = '.ormi-rich-text{padding:16px;color:var(--text-title);background:var(--bg-main);font:16px system-ui,sans-serif;min-height:100%;overflow-wrap:anywhere}';
const tags = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'h2', 'h3']);
const htmlNamespace = 'http://www.w3.org/1999/xhtml';

function parse(markup: string) {
  const template = document.createElement('template');
  template.innerHTML = sanitizeMarkup(markup);
  return template.content;
}

export function richBody(html: string): string | null {
  if (html.length > MAX_RICH_MARKUP + 64) return null;
  const source = parse(html.trim());
  const article = source.firstElementChild;
  if (source.childNodes.length !== 1 || article?.localName !== 'article' || article.getAttribute('class') !== RICH_CLASS) return null;
  return cleanRichText(article.innerHTML);
}

export function cleanRichText(html: string): string | null {
  if (html.length > MAX_RICH_MARKUP) return null;
  const source = parse(html);
  const container = document.createElement('div');
  let remaining = 512;
  let tooDeep = false;
  function copy(input: Node, parent: HTMLElement, depth: number) {
    if (--remaining < 0) return;
    if (depth > 16) { tooDeep = true; return; }
    if (input.nodeType === 3) { parent.append(input.textContent ?? ''); return; }
    if (input.nodeType !== 1) return;
    const el = input as Element;
    if (el.namespaceURI !== htmlNamespace) return;
    const output = tags.has(el.localName) ? document.createElement(el.localName) : parent;
    if (output !== parent) parent.append(output);
    for (const child of el.childNodes) copy(child, output, depth + 1);
  }
  for (const node of source.childNodes) copy(node, container, 0);
  return !tooDeep && remaining >= 0 && container.innerHTML.length <= MAX_RICH_MARKUP ? container.innerHTML : null;
}

export const richMarkup = (body: string) => `<article class="${RICH_CLASS}">${body}</article>`;
