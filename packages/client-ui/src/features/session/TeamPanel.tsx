import { Users, ChevronRight, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { SessionDetails } from './useSession.ts';
import { useSessions } from './useSessions.ts';
import { sessionForest, type SessionNode } from './team-tree.ts';
import { compactTokens } from '../../lib/format.ts';
import { TeamStateIcon, TeamStatus } from './TeamStatus.tsx';
import { approvalInput, parentlessHelp } from './team-presentation.ts';

export function TeamPanel({ details, onOpen }: { details?: SessionDetails; onOpen?: (session: string) => void }) {
  const { sessions } = useSessions();
  if (!details) return null;
  const find = (list: SessionNode[]): SessionNode | undefined => {
    for (const node of list) { if (node.session.id === details.id) return node; const child = find(node.children); if (child) return child; }
    return undefined;
  };
  const node = find(sessionForest(sessions)), parent = details.team && details.parent ? sessions.find(s => s.id === details.parent) : undefined;
  const approvals = details.teamApprovals ?? [];
  if (!details.team && !node?.children.length && !approvals.length) return null;
  const request = (approval: NonNullable<SessionDetails['teamApprovals']>[number]) => <>
    {approval.input !== undefined ? <pre className="team-command"><code>{approvalInput(approval.input)}</code></pre> : null}
    <div className="team-options">{approval.options.map(option => <span className="team-option" key={option.id}>{option.label}</span>)}<span>Once only</span></div>
  </>;
  return <section aria-label="Team">
    {details.team && details.parent ? <nav className="team-breadcrumb" aria-label="Team breadcrumb">
      <div className="team-breadcrumb-path"><Users size={12} /><span>Team</span><ChevronRight size={11} />
        <button className="team-link team-ellipsis" disabled={!onOpen} aria-label={`Back to ${parent?.title || 'parent'}`} onClick={() => onOpen?.(details.parent!)}>{parent?.title || 'Parent'}</button>
        <ChevronRight size={11} /><span className="team-ellipsis" title={details.title || undefined}>{details.title || 'Child'}</span>
      </div>
      {details.parentless ? <span className="team-status team-tone-amber" title={parentlessHelp}><TriangleAlert size={10} />Parentless</span> : null}
    </nav> : null}
    {node?.children.length || approvals.length ? <details className="team-card" open>
      <summary aria-label="Toggle team details"><span className="team-card-title"><Users size={14} />Team</span>
        {approvals.length ? <span className="team-status">{approvals.length} awaiting parent</span> : null}
        <span className="team-card-tokens"><strong>{compactTokens(node?.tokens ?? details.tokens ?? 0)} tokens total</strong><span>Parent {compactTokens(details.tokens ?? 0)}</span></span><ChevronRight size={13} className="team-card-chevron" />
      </summary>
      <div className="team-card-body">
        {node?.children.map(child => <button className="team-roster-row hv-sub" key={child.session.id} disabled={!onOpen} onClick={() => onOpen?.(child.session.id)}>
          <TeamStateIcon session={child.session} /><span className="team-roster-name"><span className="team-ellipsis" title={child.session.title || child.session.id}>{child.session.title || 'Child session'}</span><TeamStatus session={child.session} /></span><span className="team-child-tokens">{compactTokens(child.session.tokens ?? 0)} tok</span>
        </button>)}
        {approvals.length ? <section className="team-inbox" aria-label="Parent approval inbox">
          <div className="team-inbox-heading"><ShieldCheck size={13} />Parent inbox<span className="team-inbox-count">{approvals.length}</span></div>
          {approvals.map((approval, index) => {
            const title = sessions.find(s => s.id === approval.session)?.title || 'Child session';
            const heading = <><span className="team-tool">{approval.tool}</span><span className="team-ellipsis">{title}</span><span className="team-status" style={{ marginLeft: 'auto' }}>Needs parent</span></>;
            return approvals.length > 1 ? <details className="team-approval" key={`${approval.session}/${approval.request}`} open={index === 0}>
              <summary className="team-approval-heading"><ChevronRight size={11} />{heading}</summary>{request(approval)}
            </details> : <article className="team-approval" key={`${approval.session}/${approval.request}`}><div className="team-approval-heading">{heading}</div>{request(approval)}</article>;
          })}
          <p className="team-helper">The parent answers via <code>team_approve</code>. No action needed from you.</p>
        </section> : null}
      </div>
    </details> : null}
  </section>;
}
