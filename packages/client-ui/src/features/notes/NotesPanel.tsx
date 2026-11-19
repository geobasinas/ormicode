/** Notes rail: named notes per session — tab strip, debounced save,
 * one-tap-confirm delete, meta line with edit age and word count. */
import { lazy, Suspense, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ago } from '../../lib/format.ts';
import { useNotes } from './useNotes.ts';

const MarkdownEditor = lazy(() => import('../../components/MarkdownEditor.tsx').then(module => ({ default: module.MarkdownEditor })));

export function NotesPanel({ session }: { session: string }) {
  const { notes, save, remove } = useNotes(session);
  const [openId, setOpenId] = useState<string>();
  const [draft, setDraft] = useState<{ id?: string; title: string; body: string; isNew?: boolean }>();
  const [confirm, setConfirm] = useState(false);
  const editing = draft ?? notes.find(n => n.id === openId);
  const words = (editing?.body ?? '').trim().split(/\s+/).filter(Boolean).length;
  const changed = !!draft && (draft.title !== notes.find(n => n.id === draft.id)?.title || draft.body !== notes.find(n => n.id === draft.id)?.body);

  const patch = (p: Partial<typeof draft>) => {
    const base = editing ? { id: editing.id, title: editing.title, body: editing.body } : { title: 'Untitled', body: '' };
    const next = { ...base, ...p };
    setDraft(next);
    save({ id: next.id, title: next.title, body: next.body });
  };

  const head = {
    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    height: 38, boxSizing: 'border-box' as const, flexShrink: 0, padding: '0 12px', borderBottom: '1px solid var(--line-subtle)',
    fontSize: 'var(--text-xs)', color: 'var(--text-hint)',
  };
  const tab = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick} style={{
      font: 'inherit', fontSize: 11.5, cursor: 'pointer', padding: '0 8px', height: 37, whiteSpace: 'nowrap', flexShrink: 0,
      border: 'none', borderBottom: active ? '1.5px solid var(--text-title)' : '1.5px solid transparent',
      background: 'none', color: active ? 'var(--text-title)' : 'var(--text-hint)', fontWeight: active ? 600 : 400,
    }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={head}>
        <span>{notes.length} note{notes.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <button title="new note" onClick={() => { setDraft({ title: 'Untitled', body: '', isNew: true }); setOpenId(undefined); setConfirm(false); }}
          className="hv" style={{ font: 'inherit', background: 'none', border: 'none', color: 'var(--text-label)', cursor: 'pointer', display: 'inline-flex', padding: 4, borderRadius: 6 }}><Plus size={14} /></button>
      </div>
      <div className="ormi-tabs" style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--line-subtle)', flexShrink: 0, padding: '0 4px' }}>
        {notes.map(n => tab(n.title, (editing?.id ?? draft?.id) === n.id && !draft?.isNew, () => { setOpenId(n.id); setDraft(undefined); setConfirm(false); }))}
        {draft?.isNew ? tab('new', true, () => undefined) : null}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '14px 14px 10px', gap: 6 }}>
          <input value={editing.title} onChange={e => patch({ title: e.target.value })} style={{
            font: 'inherit', fontSize: 'var(--text-lg)', fontWeight: 600, background: 'transparent',
            border: 'none', outline: 'none', color: 'var(--text-title)',
          }} />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>
            {editing.id && notes.find(n => n.id === editing.id)
              ? `Edited ${ago(notes.find(n => n.id === editing.id)!.updatedAt)} · ${words} words · ${changed ? 'saving…' : 'saved'}`
              : `${words} words · unsaved`}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Suspense fallback={<div style={{ height: '100%' }} />}>
              <MarkdownEditor key={editing.id ?? 'new'} value={editing.body} onChange={body => patch({ body })} placeholder="Write a note…" />
            </Suspense>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {confirm ? (
              <button onClick={() => { if (editing.id) remove(editing.id); setDraft(undefined); setOpenId(undefined); setConfirm(false); }}
                className="hv" style={{ font: 'inherit', fontSize: 11.5, color: 'var(--accent-red)', background: 'var(--tint-red)', border: '1px solid var(--line-red)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 7 }}><Trash2 size={12} />Confirm delete</button>
            ) : (
              <button onClick={() => setConfirm(true)} disabled={!editing.id}
                className={editing.id ? 'hv' : undefined} style={{ font: 'inherit', fontSize: 11.5, color: 'var(--text-hint)', background: 'none', border: 'none', cursor: editing.id ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 7 }}><Trash2 size={12} />Delete</button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: '14px', fontSize: 12, color: 'var(--text-hint)' }}>
          No notes yet — press + to start one
        </div>
      )}
    </div>
  );
}
