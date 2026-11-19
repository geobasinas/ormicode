/** Sidebar session list, grouped by project — state icon, title, age and a
 * mono branch line per row; waiting first, done collapsed (sessions-list spec). */
import { useEffect, useMemo, useState } from 'react';
import { Check, Folder, GitBranch, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { useSessions, type SessionSummary } from './useSessions.ts';
import { StateIcon, stateLabel } from './state.tsx';
import { ago, compactTokens, projectName } from '../../lib/format.ts';
import { containsSession, needsUser, sessionForest, type SessionNode } from './team-tree.ts';
import { branchLabel, isTeamRunning, teamState } from './team-presentation.ts';
import { TeamStateIcon, TeamStatus } from './TeamStatus.tsx';

const DAY = 24 * 3600 * 1000;
const isDone = (s: SessionSummary) => s.state === 'done';
const mono = { fontFamily: 'var(--font-mono)', fontSize: 10 };

function Row({ s, active, onSelect }: { s: SessionSummary; active?: string; onSelect: (id: string) => void }) {
  const selected = s.id === active;
  const needs = needsUser(s);
  const scratch = s.project === 'scratch';
  if (s.team && s.parent) return <button className={`team-child-row hv-sub${selected ? ' is-active' : ''}`} onClick={() => onSelect(s.id)}>
    <TeamStateIcon session={s} />
    <span className="team-child-content">
      <span className="team-child-title"><span className="team-ellipsis" title={s.title || s.id}>{s.title || 'Child session'}</span><TeamStatus session={s} /></span>
      <span className="team-child-meta"><span className="team-ellipsis" title={s.branch ?? undefined}>{branchLabel(s) || s.vendor} · {ago(s.updatedAt ?? 0)}</span><span className="team-child-tokens" title="Tokens including cache usage">{compactTokens(s.tokens ?? 0)} tok</span></span>
    </span>
  </button>;
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
            : <><GitBranch size={9} style={{ flexShrink: 0 }} /><span title={s.branch} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{branchLabel(s)}</span></>}
          {s.worktree ? <span title="own worktree" style={{ border: '1px solid var(--line-card)', borderRadius: 4, padding: '0 3px', fontSize: 9, flexShrink: 0 }}>wt</span> : null}
          {s.parentless ? <span style={{ color: 'var(--accent-amber)', flexShrink: 0 }} title="Parent unavailable; this child keeps running">Parentless</span> : null}
          {s.delegatedApproval ? <span style={{ color: 'var(--text-secondary)' }}>Parent approval</span> : null}
          <span style={{ flex: 1 }} />
          {s.team || s.tokens ? <span title="Session tokens, including cache usage" style={{ flexShrink: 0 }}>{compactTokens(s.tokens ?? 0)} tok</span> : null}
          {!scratch && s.diff ? (s.diff.added || s.diff.removed ? <span title={`${s.diff.files} files changed`} style={{ flexShrink: 0 }}>
            {s.diff.files} changed</span>
            : <span style={{ flexShrink: 0 }}>clean</span>) : null}
        </span>
      </span>
    </button>
  );
}

function TeamRow({ node, active, onSelect, query }: { node: SessionNode; active?: string; onSelect: (id: string) => void; query?: string }) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { if (query || containsSession(node, active)) setExpanded(true); }, [active, query]);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const running = node.children.filter(child => isTeamRunning(child.session)).length;
  return <div data-team-session={node.session.id} className={node.children.length ? 'team-group' : undefined}>
    {node.children.length ? <>
      <div className={`team-group-header${active === node.session.id ? ' is-active' : ''}`}>
        <button className="team-toggle" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} team ${node.session.title || node.session.id}`} onClick={() => setExpanded(!expanded)}><Users size={14} /><Chevron size={10} /></button>
        <button className="team-parent" onClick={() => onSelect(node.session.id)} title={node.session.title || node.session.id}>
          <span className="team-parent-name"><TeamStateIcon session={node.session} /><span className="team-ellipsis">{node.session.title || 'Team'}</span></span>
          <span className="team-group-meta">{node.children.length} children · {running} running</span>
          {!expanded ? <span className="team-state-dots" aria-label="Child states">{node.children.map(child => <span key={child.session.id} className={`team-state-dot team-tone-${teamState(child.session).tone}`} title={`${child.session.title || 'Child'} · ${teamState(child.session).label}`} />)}</span> : null}
        </button>
        <span className="team-token-total" title="Team tokens, including parent and archived children">{compactTokens(node.tokens)}<small>tokens</small></span>
      </div>
      {expanded ? <div className="team-rail">{node.children.map(child => <TeamRow key={child.session.id} node={child} active={active} onSelect={onSelect} query={query} />)}</div> : null}
    </> : <Row s={node.session} active={active} onSelect={onSelect} />}
  </div>;
}

export function SessionList({ active, onSelect, query }: { active?: string; onSelect: (id: string) => void; query?: string }) {
  const { sessions, error } = useSessions();
  const groups = useMemo(() => {
    const byProject = new Map<string, SessionNode[]>();
    for (const node of sessionForest(sessions, query)) {
      const g = byProject.get(node.session.project) ?? [];
      g.push(node); byProject.set(node.session.project, g);
    }
    const latest = (l: SessionNode[]) => Math.max(...l.map(n => n.session.updatedAt ?? 0));
    // Projects first by recency; scratch sessions sit last under"no project" like the mockup.
    return [...byProject.entries()].sort((a, b) => Number(a[0] === 'scratch') - Number(b[0] === 'scratch') || latest(b[1]) - latest(a[1]));
  }, [sessions, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', gap: 0 }}>
      {error ? <div style={{ padding: '0 10px', color: 'var(--accent-red)', fontSize: 12 }}>{error}</div> : null}
      {groups.map(([project, list]) => {
        const open = list.filter(n => n.children.length || !isDone(n.session));
        const done = list.filter(n => !n.children.length && isDone(n.session)).map(n => n.session);
        const countWaiting = (nodes: SessionNode[]): number => nodes.reduce((sum, n) => sum + Number(needsUser(n.session)) + countWaiting(n.children), 0);
        const waiting = countWaiting(list);
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
            {open.map(node => <TeamRow key={node.session.id} node={node} active={active} onSelect={onSelect} query={query} />)}
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
