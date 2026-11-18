/** Notes rail: named notes per session — tab strip, debounced save,
 * one-tap-confirm delete, meta line with edit age and word count. */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ago } from '../../lib/format.ts';
import { useNotes } from './useNotes.ts';

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
      font: 'inherit', fontSize: 'var(--text-xs)', cursor: 'pointer', padding: '4px 8px',
      border: 'none', borderBottom: active ? '1px solid var(--accent-mint)' : '1px solid transparent',
      background: 'none', color: active ? 'var(--text-active)' : 'var(--text-secondary)',
    }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={head}>
        <span>{notes.length} note{notes.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <button title="new note" onClick={() => { setDraft({ title: 'Untitled', body: '', isNew: true }); setOpenId(undefined); setConfirm(false); }}
          style={{ font: 'inherit', background: 'none', border: 'none', color: 'var(--text-label)', cursor: 'pointer', display: 'inline-flex', padding: 2 }}><Plus size={15} /></button>
      </div>
      <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--line-subtle)', flexShrink: 0 }}>
        {notes.map(n => tab(n.title, (editing?.id ?? draft?.id) === n.id && !draft?.isNew, () => { setOpenId(n.id); setDraft(undefined); setConfirm(false); }))}
        {draft?.isNew ? tab('new', true, () => undefined) : null}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 'var(--space-3)', gap: 'var(--space-2)' }}>
          <input value={editing.title} onChange={e => patch({ title: e.target.value })} style={{
            font: 'inherit', fontSize: 'var(--text-lg)', fontWeight: 600, background: 'transparent',
            border: 'none', outline: 'none', color: 'var(--text-title)',
          }} />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>
            {editing.id && notes.find(n => n.id === editing.id)
              ? `Edited ${ago(notes.find(n => n.id === editing.id)!.updatedAt)} · ${words} words · ${changed ? 'saving…' : 'saved'}`
              : `${words} words · unsaved`}
          </div>
          <textarea value={editing.body} onChange={e => patch({ body: e.target.value })} style={{
            flex: 1, resize: 'none', font: 'inherit', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-loose)',
            background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-label)',
          }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {confirm ? (
              <button onClick={() => { if (editing.id) remove(editing.id); setDraft(undefined); setOpenId(undefined); setConfirm(false); }}
                style={{ font: 'inherit', fontSize: 'var(--text-xs)', color: 'var(--accent-red)', background: 'none', border: 'none', cursor: 'pointer' }}>confirm delete</button>
            ) : (
              <button onClick={() => setConfirm(true)} disabled={!editing.id}
                style={{ font: 'inherit', fontSize: 'var(--text-xs)', color: 'var(--text-hint)', background: 'none', border: 'none', cursor: 'pointer' }}>delete</button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-hint)' }}>
          no notes yet — + to start one
        </div>
      )}
    </div>
  );
}
