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

export function DesignAgentDock({ details, sessions, online, board, sourceDirty, onChange, onOpen }: {
  details: SessionDetails; sessions: SessionDetails[]; online: boolean; board?: DesignAgentContext; sourceDirty: boolean;
  onChange(session: string): void; onOpen(session: string): void;
}) {
  const live = useDesignAgent(details, online, board);
  const { id, state, title, cwd, branch, vendor, transport, project } = live.details;
  const projectSessions = sessionsForDesignProject(sessions, project);
  const sameWorkspace = projectSessions.filter(item => item.id === id || item.cwd === cwd);
  const otherWorkspaces = projectSessions.filter(item => item.id !== id && item.cwd !== cwd);
  const sessionChoice = (item: SessionDetails) => <option key={item.id} value={item.id}>
    {item.title ?? item.id} · {projectName(item.project)}{item.branch ? ` · ${item.branch}` : ''}
  </option>;

  return <section className="design-agent design-agent-dock" aria-label="Design agent">
    <div className="design-section-heading"><Workflow size={13} /> <span>Linked session</span>
      <button type="button" className="design-icon-button" aria-label="Open session chat" title="Open session chat" onClick={() => onOpen(id)}><ArrowUpRight size={15} /></button>
    </div>
    <select aria-label="Design project and session" className="design-input design-session-select" disabled={sourceDirty}
      title={sourceDirty ? 'Save or discard source before switching sessions' : title ?? id} value={id} onChange={event => onChange(event.target.value)}>
      <optgroup label="This working tree">{sameWorkspace.map(sessionChoice)}</optgroup>
      {otherWorkspaces.length ? <optgroup label="Other working trees">{otherWorkspaces.map(sessionChoice)}</optgroup> : null}
    </select>
    <div className="design-branch" title={cwd}><GitBranch size={12} /> <span>{branch ?? cwd}</span></div>
    <div className="design-agent-state" role="status" data-failed={FAILED.has(state)}>
      <strong>{online ? LABELS[state] ?? state : 'Offline'}</strong><span>{vendor} · {transport}</span>
    </div>
    {ACTIVE.has(state) && live.lastPrompt ? <p className="design-agent-copy" title={live.lastPrompt}>{live.lastPrompt}</p> : null}
    {FAILED.has(state) && live.lastError ? <p className="design-agent-error">{live.lastError}</p> : null}
    {board ? <details className="design-agent-edits" open>
      <summary>Recent board edits</summary>
      <ol aria-label="Recent board edits">
        {live.activity?.edits.map(edit => {
          const origin = sessions.find(item => item.id === edit.originSession);
          return <li key={edit.revision} title={edit.originSession}>
            <span>r{edit.revision} · {edit.summary ?? 'Board edit'}</span>
            <small>{origin?.title ?? edit.originSession ?? 'Unknown session'}{edit.source === 'mcp' ? ' · MCP' : ''}</small>
          </li>;
        })}
      </ol>
      {live.activity?.error ? <p className="design-agent-error">{live.activity.error}</p>
        : !live.activity?.edits.length ? <p className="design-agent-copy">{live.activity ? 'No journaled edits yet.' : online ? 'Loading edits…' : 'Offline'}</p> : null}
    </details> : null}
    {board ? <p className="design-agent-copy" title={board.frame?.name ?? board.name}>Task context: {board.frame?.name ?? board.name} · r{board.revision}</p> : null}
    <Composer session={id} details={live.details} taskContext={board ? designTaskContext(board) : undefined} compact />
  </section>;
}
