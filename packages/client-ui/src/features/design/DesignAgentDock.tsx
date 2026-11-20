import { useEffect, useRef } from 'react';
import { ArrowUpRight, GitBranch, Workflow } from 'lucide-react';
import { Composer } from '../session/Composer.tsx';
import type { SessionDetails } from '../session/useSession.ts';
import { projectName } from '../../lib/format.ts';
import { designTaskContext, type DesignAgentContext } from './design-agent-context.ts';
import { sessionsForDesignProject } from './design-sessions.ts';
import { useDesignAgent } from './useDesignAgent.ts';

const LABELS: Record<string, string> = {
  starting: 'Starting', running: 'Running', retrying: 'Retrying', awaiting_approval: 'Waiting for approval',
  awaiting_input: 'Waiting for input', paused_rate_limited: 'Rate limited', failed: 'Failed', interrupted: 'Interrupted',
  idle: 'Idle', done: 'Done', archived: 'Archived',
};
const ACTIVE = new Set(['running', 'starting', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited']);
const FAILED = new Set(['failed', 'interrupted', 'paused_rate_limited']);
const OPERATION = /\b(?:frame|board|element|style|page|token|layer)\.[A-Za-z][\w-]*/;

export function sessionOptionLabel(item: { id: string; title?: string | null; branch?: string | null }): string {
  const name = item.title?.trim() || item.id;
  const branch = item.branch?.trim() ?? '';
  const labeled = branch ? `${name} · ${branch}` : name;
  if (!branch || branch.length > 18 || labeled.length > 46) return name;
  return labeled;
}

export function sessionOptionTitle(item: { id: string; title?: string | null; project?: string; branch?: string | null; cwd?: string }): string {
  const name = item.title?.trim() || item.id;
  return [name, item.project ? projectName(item.project) : '', item.branch?.trim(), item.cwd?.trim()].filter(Boolean).join(' · ');
}

export function designContextLabel(board: DesignAgentContext): string {
  return `On ${board.frame?.name || board.name} · r${board.revision}`;
}

/** `rN · action` plus a short origin. Long prompts are not repeated on either line. */
export function designEditRow(edit: { revision: number; summary?: string; source?: 'mcp'; originSession?: string }, originTitle?: string | null): { primary: string; secondary: string } {
  const summary = edit.summary?.trim() ?? '';
  const title = originTitle?.trim() ?? '';
  const operation = summary.match(OPERATION)?.[0];
  const repeatsPrompt = !summary || summary === title || (Boolean(title) && title.length > 24 && summary.includes(title)) || summary.length > 48 || summary.split(/\s+/).length > 8;
  const action = operation && (repeatsPrompt || summary === operation || summary.startsWith(`${operation} `) || summary.startsWith(`${operation}:`) || summary.startsWith(`${operation},`))
    ? operation
    : summary && !repeatsPrompt ? summary : operation || 'Board edit';
  const shortTitle = title && title !== summary && title !== action && title.length <= 36 && title.split(/\s+/).length <= 5 && !summary.includes(title);
  const secondary = shortTitle ? title : edit.source === 'mcp' || !edit.originSession ? 'MCP' : 'Session';
  return { primary: `r${edit.revision} · ${action}`, secondary };
}

export function DesignAgentDock({ details, sessions, online, board, sourceDirty, onChange, onOpen }: {
  details: SessionDetails; sessions: SessionDetails[]; online: boolean; board?: DesignAgentContext; sourceDirty: boolean;
  onChange(session: string): void; onOpen(session: string): void;
}) {
  const live = useDesignAgent(details, online, board);
  const { id, state, title, cwd, branch, vendor, transport, project } = live.details;
  const projectSessions = sessionsForDesignProject(sessions, project);
  const sameWorkspace = projectSessions.filter(item => item.id === id || item.cwd === cwd);
  const otherWorkspaces = projectSessions.filter(item => item.id !== id && item.cwd !== cwd);
  const selectedTitle = sessionOptionTitle(live.details);
  const edits = live.activity?.edits ?? [];
  const editsRef = useRef<HTMLDetailsElement>(null);
  const seededSlug = useRef('');
  useEffect(() => {
    if (!board || !live.activity || seededSlug.current === board.slug) return;
    seededSlug.current = board.slug;
    if (editsRef.current) editsRef.current.open = live.activity.edits.length > 0;
  }, [board, live.activity]);
  const sessionChoice = (item: SessionDetails) => <option key={item.id} value={item.id} title={sessionOptionTitle(item)}>
    {sessionOptionLabel(item)}
  </option>;
  const place = board?.frame?.name || board?.name || '';
  const location = [branch, cwd].filter(Boolean).join(' · ');

  return <section className="design-agent design-agent-dock" aria-label="Design agent">
    <div className="design-section-heading"><Workflow size={13} /> <span>Linked session</span>
      <button type="button" className="design-icon-button" aria-label="Open session chat" title="Open session chat" onClick={() => onOpen(id)}><ArrowUpRight size={15} /></button>
    </div>
    <select aria-label="Design project and session" className="design-input design-session-select" disabled={sourceDirty}
      title={sourceDirty ? `Save or discard source before switching sessions. ${selectedTitle}` : selectedTitle} value={id} onChange={event => onChange(event.target.value)}>
      <optgroup label="This working tree">{sameWorkspace.map(sessionChoice)}</optgroup>
      {otherWorkspaces.length ? <optgroup label="Other working trees">{otherWorkspaces.map(sessionChoice)}</optgroup> : null}
    </select>
    <div className="design-agent-state" role="status" data-failed={FAILED.has(state)}>
      <strong>{online ? LABELS[state] ?? state : 'Offline'}</strong>
      <span className="design-agent-transport">{vendor} · {transport}</span>
      {location ? <span className="design-agent-branch" title={location}><GitBranch size={12} /><span>{branch || cwd}</span></span> : null}
    </div>
    {ACTIVE.has(state) && live.lastPrompt ? <p className="design-agent-copy" title={live.lastPrompt}>{live.lastPrompt}</p> : null}
    {FAILED.has(state) && live.lastError ? <p className="design-agent-error">{live.lastError}</p> : null}
    {board ? <details className="design-agent-edits" ref={editsRef}>
      <summary>Recent board edits</summary>
      {edits.length ? <ol aria-label="Recent board edits">
        {edits.map(edit => {
          const origin = sessions.find(item => item.id === edit.originSession);
          const row = designEditRow(edit, origin?.title);
          return <li key={edit.revision} title={edit.summary || row.primary}>
            <span>{row.primary}</span>
            <small>{row.secondary}</small>
          </li>;
        })}
      </ol> : null}
      {live.activity?.error ? <p className="design-agent-error">{live.activity.error}</p>
        : !edits.length ? <p className="design-agent-copy">{live.activity ? 'No board edits yet.' : online ? 'Loading edits…' : 'Offline'}</p> : null}
    </details> : null}
    {board ? <p className="design-agent-context" title={place}>{designContextLabel(board)}</p> : null}
    <Composer session={id} details={live.details} taskContext={board ? designTaskContext(board) : undefined} compact />
  </section>;
}
