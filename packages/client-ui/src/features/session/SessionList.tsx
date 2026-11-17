/** Sidebar session list, grouped by project — state icon + title + age,
 * carry-over and waiting sessions first (per the sessions-list spec). */
import { useMemo, useState } from 'react';
import { Play, LoaderCircle, CircleAlert, Pause, CircleX, Moon, Check, Archive, Folder, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { useSessions, type SessionSummary } from './useSessions.ts';
import { ago, projectName } from '../../lib/format.ts';

const stateIcon: Record<string, { icon: LucideIcon; color: string }> = {
  running: { icon: Play, color: 'var(--accent-mint)' },
  starting: { icon: LoaderCircle, color: 'var(--accent-mint)' },
  retrying: { icon: LoaderCircle, color: 'var(--accent-amber)' },
  awaiting_approval: { icon: CircleAlert, color: 'var(--accent-amber)' },
  awaiting_input: { icon: CircleAlert, color: 'var(--accent-amber)' },
  paused_rate_limited: { icon: Pause, color: 'var(--accent-amber)' },
  interrupted: { icon: Pause, color: 'var(--accent-amber)' },
  failed: { icon: CircleX, color: 'var(--accent-red)' },
  idle: { icon: Moon, color: 'var(--text-hint)' },
  done: { icon: Check, color: 'var(--text-secondary)' },
  archived: { icon: Archive, color: 'var(--text-hint)' },
};
const needsYou = new Set(['awaiting_approval', 'awaiting_input', 'interrupted', 'failed', 'paused_rate_limited']);
const finished = new Set(['done', 'idle']);
const rank = (s: SessionSummary) => (needsYou.has(s.state) ? 0 : s.state === 'running' || s.state === 'starting' ? 1 : 2);
const DAY = 24 * 3600 * 1000;
const today = (s: SessionSummary) => finished.has(s.state) && Date.now() - (s.updatedAt ?? 0) < DAY;

function Row({ s, active, onSelect }: { s: SessionSummary; active?: string; onSelect: (id: string) => void }) {
  const ic = stateIcon[s.state] ?? stateIcon.idle!;
  return (
    <button onClick={() => onSelect(s.id)} style={{
      textAlign: 'left', width: '100%', padding: '6px 10px',
      border: 'none', cursor: 'pointer', font: 'inherit',
      background: s.id === active ? 'var(--bg-card)' : 'transparent', color: 'var(--text-label)',
      borderRadius: 7, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <ic.icon size={13} style={{ color: ic.color, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 500,
          color: s.id === active ? 'var(--text-active)' : '#bbbbbb',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id.slice(0, 12)}</span>
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-hint)', flexShrink: 0, marginLeft: 8 }}>{ago(s.updatedAt ?? 0)}</span>
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {s.state}{s.vendor ? ` · ${s.vendor}` : ''}
        </span>
      </span>
    </button>
  );
}

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', gap: 2 }}>
      {error ? <div style={{ padding: '0 10px', color: 'var(--accent-red)', fontSize: 13 }}>{error}</div> : null}
      {groups.map(([project, list]) => {
        const open = list.filter(s => !today(s));
        const done = list.filter(today);
        return (
          <div key={project}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 4px',
              fontSize: 13, fontWeight: 600, color: 'var(--text-label)',
            }}>
              <Folder size={12} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
              {projectName(project)}
              <span style={{ flex: 1 }} />
              <span style={{ fontWeight: 400, color: 'var(--text-hint)', fontSize: 11 }}>{list.length}</span>
            </div>
            {open.map(s => <Row key={s.id} s={s} active={active} onSelect={onSelect} />)}
            {done.length ? <FinishedGroup done={done} active={active} onSelect={onSelect} /> : null}
          </div>
        );
      })}
      {!groups.length && !error ? <div style={{ padding: '0 10px', color: 'var(--text-hint)', fontSize: 13 }}>no sessions</div> : null}
    </div>
  );
}

function FinishedGroup({ done, active, onSelect }: { done: SessionSummary[]; active?: string; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div>
      <button onClick={() => setExpanded(!expanded)} style={{
        textAlign: 'left', width: '100%', padding: '5px 10px', border: 'none', cursor: 'pointer',
        font: 'inherit', background: 'transparent', color: 'var(--text-secondary)',
        borderRadius: 7, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
      }}>
        <Check size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{done.length} finished today</span>
        <Chevron size={12} style={{ color: 'var(--text-hint)' }} />
      </button>
      {expanded ? done.map(s => <Row key={s.id} s={s} active={active} onSelect={onSelect} />) : null}
    </div>
  );
}
