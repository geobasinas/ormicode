import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { DESIGN_PROTOTYPE_ATTRIBUTE as attribute, isDesignPrototypeAction } from '@ormicode/protocol';

export function remapPrototypeTargets(html: string, frameIds: ReadonlyMap<string, string>): string {
  if (!html.toLowerCase().includes(attribute)) return html;
  const root = parseFragment(html, { sourceCodeLocationInfo: true });
  const pending: DefaultTreeAdapterTypes.Node[] = [root];
  const replacements: { startOffset: number; endOffset: number; value: string }[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
    if (!('attrs' in node)) continue;
    const value = node.attrs.find(attr => attr.name === attribute)?.value;
    if (!isDesignPrototypeAction(value) || value === 'back' || value === 'close-overlay') continue;
    const [kind, id] = value.split(':');
    const target = id && frameIds.get(id);
    const location = node.sourceCodeLocation?.attrs?.[attribute];
    if (target && location) replacements.push({ ...location, value: `${kind}:${target}` });
  }
  // Keep all unrelated markup intact, including whitespace and literal examples.
  for (const { startOffset, endOffset, value } of replacements.sort((a, b) => b.startOffset - a.startOffset)) {
    html = html.slice(0, startOffset) + attribute + '="' + value + '"' + html.slice(endOffset);
  }
  return html;
}
