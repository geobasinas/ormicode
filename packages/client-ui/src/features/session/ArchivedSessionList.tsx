/** Archived sessions (sidebar Archived filter and archived search hits): open
 * one read-only, or restore it to the live list. */
import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { ago, projectName } from '../../lib/format.ts';
import { useSessions, type SessionSummary } from './useSessions.ts';
import { matchArchived, setSessionArchived } from './session-archive.ts';

export function ArchivedSessionList({ active, onSelect, query, heading }: { active?: string; onSelect: (id: string) => void; query?: string; heading?: boolean }) {
  const { transport } = usePlatform();
  const { sessions, error } = useSessions({ archived: true });
  const [restoring, setRestoring] = useState<string>();
  const list = useMemo(() => matchArchived(sessions, query), [sessions, query]);
  const restore = async (s: SessionSummary) => {
    if (restoring) return;
    setRestoring(s.id);
    const failure = await setSessionArchived(transport, s.id, false);
    setRestoring(undefined);
    if (failure) feedback.error(failure);
    else feedback.success('Session restored', { label: 'Open', onClick: () => onSelect(s.id) });
  };
  if (heading && !list.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {heading ? <div style={{ display: 'flex', alignItems: 'center', gap: 13, height: 26, padding: '0 12px 0 13px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
        <Archive size={13} style={{ flexShrink: 0 }} /><span>Archived</span>
      </div> : null}
      {error ? <div style={{ padding: '0 10px', color: 'var(--accent-red)', fontSize: 12 }}>{error}</div> : null}
      {list.map(s => {
        const selected = s.id === active;
        const title = s.title || s.id.slice(0, 12);
        return (
          <div key={s.id} data-archived-session={s.id} className={selected ? 'hv-sub ormi-selected-row' : 'hv-sub'} style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 6px 0 10px', borderRadius: 7, flexShrink: 0,
            background: selected ? 'var(--bg-selected)' : 'transparent',
          }}>
            <button onClick={() => onSelect(s.id)} title={title} style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 13, height: '100%', padding: 0,
              border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left',
            }}>
              <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}><Archive size={12} style={{ color: 'var(--text-hint)' }} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: selected ? 'var(--text-active)' : 'var(--text-label)' }}>{title}</span>
                <span style={{ display: 'block', marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.project === 'scratch' ? 'No project' : projectName(s.project)} · {ago(s.updatedAt ?? 0)}
                </span>
              </span>
            </button>
            <button className="hv" aria-label={`Restore session ${title}`} title="Restore session" disabled={restoring === s.id} onClick={() => void restore(s)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 7px', flexShrink: 0,
              border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-raised)', color: 'var(--text-secondary)',
              font: 'inherit', fontSize: 11, cursor: 'pointer',
            }}><ArchiveRestore size={12} />{restoring === s.id ? 'Restoring…' : 'Restore'}</button>
          </div>
        );
      })}
      {!heading && !list.length && !error ? <div style={{ padding: '0 13px', color: 'var(--text-hint)', fontSize: 12 }}>{query ? 'no matches' : 'no archived sessions'}</div> : null}
    </div>
  );
}
