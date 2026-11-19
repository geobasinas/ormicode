/** CodeMirror 6 setup for the Files viewer/editor: theme from the app's CSS
 *  variables (so dark/light follow the app), lazy language loading by file
 *  name, and a blame gutter. */
import { EditorView, lineNumbers, drawSelection, highlightActiveLine, keymap, gutter, GutterMarker, highlightSpecialChars } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting, LanguageDescription, bracketMatching, foldGutter } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import type { Blame } from './types.ts';
import { ago } from '../../lib/format.ts';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg-inset)', color: 'var(--text-label)', fontSize: '11.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '18px' },
  '.cm-content': { caretColor: 'var(--text-title)', padding: '6px 0' },
  '.cm-cursor': { borderLeftColor: 'var(--text-title)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-inset)', color: 'var(--text-hint)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine': { backgroundColor: 'var(--bg-inset)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--bg-selected) !important' },
  '.cm-selectionMatch': { backgroundColor: 'var(--bg-selected)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--bg-raised)', outline: 'none' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
  '.cm-panels': { backgroundColor: 'var(--bg-card)', color: 'var(--text-label)', borderColor: 'var(--line-card)' },
  '.cm-panels input, .cm-panels button': { font: 'inherit', fontSize: '11px' },
  '.cm-searchMatch': { backgroundColor: 'var(--bg-selected)' },
  '.cm-blame': { width: '170px' },
  '.cm-blame .cm-gutterElement': { padding: '0 10px', fontSize: '10.5px', color: 'var(--text-hint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-changedLine': { backgroundColor: 'var(--tint-mint) !important' },
  '.cm-changedText': { color: 'var(--accent-mint) !important' },
  '.cm-deletedChunk': { backgroundColor: 'var(--tint-red) !important', paddingLeft: '6px' },
  '.cm-deletedChunk .cm-deletedText': { color: 'var(--accent-red) !important' },
  '.cm-changeGutter': { width: '3px', paddingLeft: '2px' },
  '.cm-changedLineGutter': { background: 'var(--accent-mint)' },
  '.cm-deletedLineGutter': { background: 'var(--accent-red)' },
});

const style = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--text-hint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.tagName, t.heading], color: 'var(--syn-keyword)', fontWeight: '500' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--text-label)' },
  { tag: [t.punctuation, t.operator, t.bracket], color: 'var(--text-secondary)' },
  { tag: t.link, color: 'var(--syn-function)', textDecoration: 'underline' },
  { tag: t.strong, fontWeight: '600' }, { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--accent-red)' },
]);

export function baseExtensions(): Extension[] {
  return [
    lineNumbers(), foldGutter(), highlightSpecialChars(), drawSelection(), highlightActiveLine(), history(), bracketMatching(),
    highlightSelectionMatches(), syntaxHighlighting(style), theme, EditorState.tabSize.of(2),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  ];
}

export async function languageFor(path: string): Promise<Extension | null> {
  const desc = LanguageDescription.matchFilename(languages, path.slice(path.lastIndexOf('/') + 1));
  if (!desc) return null;
  try { return await desc.load(); } catch { return null; }
}

export function languageName(path: string): string {
  return LanguageDescription.matchFilename(languages, path.slice(path.lastIndexOf('/') + 1))?.name.toLowerCase() ?? '';
}

class BlameMarker extends GutterMarker {
  private readonly label: string; private readonly tip: string;
  constructor(label: string, tip: string) { super(); this.label = label; this.tip = tip; }
  override eq(other: BlameMarker) { return other.label === this.label; }
  override toDOM() { const el = document.createElement('span'); el.textContent = this.label; el.title = this.tip; return el; }
}

/** One label per blame hunk (short sha · author · age); the rest of the hunk stays blank. */
export function blameGutter(blame: Blame): Extension {
  const starts = new Map<number, BlameMarker>();
  let prev = '';
  for (const h of [...blame.hunks].sort((x, y) => x.start - y.start)) {
    if (h.sha === prev) continue;
    prev = h.sha;
    const c = blame.commits[h.sha];
    const uncommitted = /^0+$/.test(h.sha);
    const label = uncommitted ? 'not committed' : `${h.sha.slice(0, 7)} · ${c?.author ?? ''} · ${c ? ago(c.ts) : ''}`;
    const tip = uncommitted ? 'Not committed yet' : `${c?.summary ?? ''}${c?.session ? `\nsession ${c.session}` : ''}`;
    starts.set(h.start, new BlameMarker(label, tip));
  }
  return gutter({
    class: 'cm-blame',
    lineMarker: (view, line) => starts.get(view.state.doc.lineAt(line.from).number) ?? null,
    initialSpacer: () => new BlameMarker('0000000 · someone · 10d', ''),
  });
}
