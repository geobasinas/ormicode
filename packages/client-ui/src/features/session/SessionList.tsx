/** Sidebar session list, grouped by project — state icon + title + age,
 * carry-over and waiting sessions first (per the sessions-list spec). */
import { useMemo } from 'react';
import { useSessions, type SessionSummary } from './useSessions.ts';
import { ago } from '../../lib/format.ts';

const stateIcon: Record<string, { glyph: string; color: string }> = {
  running: { glyph: '▶', color: 'var(--accent-mint)' },
  starting: { glyph: '▶', color: 'var(--accent-mint)' },
  retrying: { glyph: '↻', color: 'var(--accent-amber)' },
  awaiting_approval: { glyph: '●', color: 'var(--accent-amber)' },
  awaiting_input: { glyph: '●', color: 'var(--accent-amber)' },
  paused_rate_limited: { glyph: '⏸', color: 'var(--accent-amber)' },
  interrupted: { glyph: '⏸', color: 'var(--accent-amber)' },
  failed: { glyph: '✗', color: 'var(--accent-red)' },
  idle: { glyph: '○', color: 'var(--text-hint)' },
  done: { glyph: '✓', color: 'var(--text-secondary)' },
  archived: { glyph: '■', color: 'var(--text-hint)' },
};
const needsYou = new Set(['awaiting_approval', 'awaiting_input', 'interrupted', 'failed', 'paused_rate_limited']);
const rank = (s: SessionSummary) => (needsYou.has(s.state) ? 0 : s.state === 'running' || s.state === 'starting' ? 1 : 2);

export function SessionList({ active, onSelect, query }: { active?: string; onSelect: (id: string) => void; query?: string }) {
  const { sessions, error } = useSessions();
  const groups = useMemo(() => {
    const q = query?.trim().toLowerCase();
    const visible = sessions.filter(s => s.state !== 'archived' &&
      (!q || `${s.title ?? ''} ${s.project} ${s.vendor}`.toLowerCase().includes(q)));
    const byProject = new Map<string, SessionSummary[]>();
    for (const s of visible) {
      const g = byProject.get(s.project) ?? [];
      g.push(s); byProject.set(s.project, g);
    }
    for (const g of byProject.values()) g.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return [...byProject.entries()].sort((a, b) =>
      Math.max(...b[1].map(s => s.updatedAt ?? 0)) - Math.max(...a[1].map(s => s.updatedAt ?? 0)));
  }, [sessions, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {error ? <div style={{ padding: '0 var(--space-3)', color: 'var(--accent-red)', fontSize: 'var(--text-sm)' }}>{error}</div> : null}
      {groups.map(([project, list]) => (
        <div key={project} style={{ marginBottom: 'var(--space-2)' }}>
          <div style={{
            padding: 'var(--space-2) var(--space-3) var(--space-1)', fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ color: 'var(--text-hint)' }}>▾</span>{project}
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-hint)' }}>{list.length}</span>
          </div>
          {list.map(s => {
            const ic = stateIcon[s.state] ?? stateIcon.idle!;
            return (
              <button key={s.id} onClick={() => onSelect(s.id)} style={{
                textAlign: 'left', padding: '4px var(--space-3) 4px var(--space-4)',
                border: 'none', cursor: 'pointer', font: 'inherit',
                background: s.id === active ? 'var(--bg-card)' : 'transparent', color: 'var(--text-label)',
                borderRadius: 'var(--radius-sm)', margin: '0 var(--space-2)', width: 'calc(100% - var(--space-4))',
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              }}>
                <span style={{ color: ic.color, fontSize: 'var(--text-xs)', width: 12 }}>{ic.glyph}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: s.id === active ? 'var(--text-active)' : undefined,
                  }}>{s.title || s.id.slice(0, 12)}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>
                    {s.state}{s.vendor ? ` · ${s.vendor}` : ''}
                  </span>
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)', flexShrink: 0 }}>{ago(s.updatedAt ?? 0)}</span>
              </button>
            );
          })}
        </div>
      ))}
      {!groups.length && !error ? <div style={{ padding: '0 var(--space-3)', color: 'var(--text-hint)', fontSize: 'var(--text-sm)' }}>no sessions</div> : null}
    </div>
  );
}
