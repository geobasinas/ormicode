/** One CodeMirror view: read-only viewer by default, editable on request,
 *  optional unified diff against another version and a blame gutter. */
import { useEffect, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { unifiedMergeView } from '@codemirror/merge';
import { baseExtensions, blameGutter, languageFor } from './editor.ts';
import type { Blame } from './types.ts';

export interface CodeViewProps {
  path: string; doc: string; editable: boolean; original?: string; blame?: Blame; line?: number;
  onChange?: (doc: string) => void; onSelection?: (sel: { from: number; to: number; text: string } | null) => void; onSave?: () => void;
}

export function CodeView({ path, doc, editable, original, blame, line, onChange, onSelection, onSave }: CodeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editComp = useRef(new Compartment());
  const langComp = useRef(new Compartment());
  const cb = useRef({ onChange, onSelection, onSave });
  cb.current = { onChange, onSelection, onSave };

  useEffect(() => {
    if (!host.current) return;
    const extra: Extension[] = original === undefined ? []
      : [unifiedMergeView({ original, mergeControls: false, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true })];
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc,
        extensions: [
          ...(blame ? [blameGutter(blame)] : []), ...baseExtensions(), ...extra,
          langComp.current.of([]),
          editComp.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave?.(); return true; } }]),
          EditorView.updateListener.of(u => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const r = u.state.selection.main;
              if (r.empty) cb.current.onSelection?.(null);
              else {
                const a = u.state.doc.lineAt(r.from).number; const b = u.state.doc.lineAt(r.to).number;
                cb.current.onSelection?.({ from: a, to: b, text: u.state.sliceDoc(r.from, r.to) });
              }
            }
          }),
        ],
      }),
    });
    view.current = v;
    let alive = true;
    void languageFor(path).then(lang => { if (alive && lang) v.dispatch({ effects: langComp.current.reconfigure(lang) }); });
    if (line && line <= v.state.doc.lines) {
      const pos = v.state.doc.line(line).from;
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
    return () => { alive = false; v.destroy(); view.current = null; };
    // editable is reconfigured below without rebuilding the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, doc, original, blame, line]);

  useEffect(() => {
    view.current?.dispatch({ effects: editComp.current.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]) });
    if (editable) view.current?.focus();
  }, [editable]);

  return <div ref={host} style={{ height: '100%', minHeight: 0, overflow: 'hidden' }} />;
}
