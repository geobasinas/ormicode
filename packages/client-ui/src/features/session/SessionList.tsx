/** Sidebar session list, grouped by project — state icon, title, age and a
 * mono branch line per row; waiting first, done collapsed (sessions-list spec). */
import { useMemo, useState } from 'react';
import { Check, Folder, GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import { useSessions, type SessionSummary } from './useSessions.ts';
import { StateIcon, NEEDS_YOU, LIVE, stateLabel } from './state.tsx';
import { ago, projectName } from '../../lib/format.ts';

const rank = (s: SessionSummary) => (NEEDS_YOU.has(s.state) ? 0 : LIVE.has(s.state) ? 1 : 2);
const DAY = 24 * 3600 * 1000;
const isDone = (s: SessionSummary) => s.state === 'done';
const mono = { fontFamily: 'var(--font-mono)', fontSize: 10 };

function Row({ s, active, onSelect }: { s: SessionSummary; active?: string; onSelect: (id: string) => void }) {
  const selected = s.id === active;
  const needs = NEEDS_YOU.has(s.state);
  const scratch = s.project === 'scratch';
  return (
    <button className={selected ? 'hv-sub ormi-selected-row' : 'hv-sub'} onClick={() => onSelect(s.id)} title={stateLabel(s.state)} style={{
      textAlign: 'left', width: '100%', height: 38, padding: '0 8px 0 10px', flexShrink: 0,
      border: 'none', cursor: 'pointer', font: 'inherit', background: selected ? 'var(--bg-selected)' : 'transparent',
      borderRadius: 7, display: 'flex', alignItems: 'center', gap: 13,
    }}>
      <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}><StateIcon state={s.state} size={12} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5,
            fontWeight: selected || needs ? 600 : 400, color: selected ? 'var(--text-active)' : 'var(--text-label)',
          }}>{s.title || s.id.slice(0, 12)}</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', flexShrink: 0 }}>{ago(s.updatedAt ?? 0)}</span>
        </span>
        <span style={{ ...mono, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, color: 'var(--text-secondary)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {scratch || !s.branch ? <span>{scratch ? 'No project' : s.vendor ?? ''}</span>
            : <><GitBranch size={9} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.branch}</span></>}
          {s.worktree ? <span title="own worktree" style={{ border: '1px solid var(--line-card)', borderRadius: 4, padding: '0 3px', fontSize: 9, flexShrink: 0 }}>wt</span> : null}
          <span style={{ flex: 1 }} />
          {!scratch && s.diff ? (s.diff.added || s.diff.removed ? <span title={`${s.diff.files} files changed`} style={{ flexShrink: 0 }}>
            {s.diff.files} changed</span>
            : <span style={{ flexShrink: 0 }}>clean</span>) : null}
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
      (!q || `${s.title ?? ''} ${s.project} ${s.vendor} ${s.branch ?? ''}`.toLowerCase().includes(q)));
    const byProject = new Map<string, SessionSummary[]>();
    for (const s of visible) {
      const g = byProject.get(s.project) ?? [];
      g.push(s); byProject.set(s.project, g);
    }
    for (const g of byProject.values()) g.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const latest = (l: SessionSummary[]) => Math.max(...l.map(s => s.updatedAt ?? 0));
    // Projects first by recency; scratch sessions sit last under"no project" like the mockup.
    return [...byProject.entries()].sort((a, b) => Number(a[0] === 'scratch') - Number(b[0] === 'scratch') || latest(b[1]) - latest(a[1]));
  }, [sessions, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', gap: 0 }}>
      {error ? <div style={{ padding: '0 10px', color: 'var(--accent-red)', fontSize: 12 }}>{error}</div> : null}
      {groups.map(([project, list]) => {
        const open = list.filter(s => !isDone(s));
        const done = list.filter(isDone);
        const waiting = list.filter(s => NEEDS_YOU.has(s.state)).length;
        return (
          <div key={project} style={{ marginBottom: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 13, height: 26, padding: '0 12px 0 13px',
              fontSize: 12, fontWeight: 600, color: project === 'scratch' ? 'var(--text-secondary)' : 'var(--text-label)',
            }}>
              <Folder size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project === 'scratch' ? 'No project' : projectName(project)}</span>
              {waiting ? <span style={{ fontWeight: 400, color: 'var(--accent-amber)', fontSize: 10.5 }} title="needs you">{waiting} waiting</span> : null}
            </div>
            {open.map(s => <Row key={s.id} s={s} active={active} onSelect={onSelect} />)}
            {done.length ? <FinishedGroup done={done} active={active} onSelect={onSelect} /> : null}
          </div>
        );
      })}
      {!groups.length && !error ? <div style={{ padding: '0 13px', color: 'var(--text-hint)', fontSize: 12 }}>{query ? 'no matches' : 'no sessions yet'}</div> : null}
    </div>
  );
}

function FinishedGroup({ done, active, onSelect }: { done: SessionSummary[]; active?: string; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const today = done.filter(s => Date.now() - (s.updatedAt ?? 0) < DAY).length;
  return (
    <div>
      <button className="hv-sub" onClick={() => setExpanded(!expanded)} style={{
        textAlign: 'left', width: '100%', height: 26, padding: '0 12px 0 10px', border: 'none', cursor: 'pointer',
        font: 'inherit', background: 'transparent', color: 'var(--text-secondary)',
        borderRadius: 7, display: 'flex', alignItems: 'center', gap: 13, fontSize: 12,
      }}>
        <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}><Check size={12} style={{ color: 'var(--text-secondary)' }} /></span>
        <span style={{ flex: 1 }}>{today === done.length ? `${done.length} finished today` : `${done.length} finished`}</span>
        <Chevron size={12} style={{ color: 'var(--text-hint)' }} />
      </button>
      {expanded ? done.map(s => <Row key={s.id} s={s} active={active} onSelect={onSelect} />) : null}
    </div>
  );
}
