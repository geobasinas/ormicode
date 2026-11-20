import { useLayoutEffect, useRef, useState } from 'react';
import { Users, ChevronRight } from 'lucide-react';
import type { SessionDetails } from './useSession.ts';
import { useSessions } from './useSessions.ts';
import { sessionForest, type SessionNode } from './team-tree.ts';
import { compactTokens } from '../../lib/format.ts';
import { approvalInput, approvalPreview, parentlessHelp, teamState, visibleTeamChips } from './team-presentation.ts';

const approvalHelp = 'The parent answers via team_approve. No action needed from you.';
type Approval = NonNullable<SessionDetails['teamApprovals']>[number];

function ApprovalLine({ approval, title }: { approval: Approval; title: string }) {
  return <details className="team-request">
    <summary title={`${approval.tool} · ${approvalHelp}`}><span className="team-dot team-tone-amber" /><span className="team-ellipsis">{title} wants to run <code>{approvalPreview(approval.input, approval.tool)}</code></span><span className="team-decision">· parent decides</span><ChevronRight size={10} /></summary>
    <pre className="team-command"><code>{approvalInput(approval.input) || approval.tool}</code></pre>
  </details>;
}

function Roster({ children, onOpen }: { children: SessionNode[]; onOpen?: (session: string) => void }) {
  const container = useRef<HTMLDivElement>(null), measure = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(0), [expanded, setExpanded] = useState(false);
  const signature = children.map(child => `${child.session.id}/${child.session.title}/${child.session.tokens}`).join('|');
  useLayoutEffect(() => {
    const update = () => setVisible(visibleTeamChips(container.current?.clientWidth ?? 0, Array.from(measure.current?.children ?? [], el => el.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    if (container.current) observer.observe(container.current);
    if (measure.current) observer.observe(measure.current);
    return () => observer.disconnect();
  }, [signature]);
  const content = (child: SessionNode) => <><span className={`team-dot team-tone-${child.session.delegatedApproval ? 'amber' : teamState(child.session).tone}`} /><span className="team-ellipsis">{child.session.title || 'Child session'}</span><span className="team-chip-tokens">{compactTokens(child.session.tokens ?? 0)}</span></>;
  return <div ref={container} className={`team-chips${expanded ? ' is-expanded' : ''}`}>
    <div ref={measure} className="team-chip-measure" aria-hidden="true">{children.map(child => <span className="team-member" key={child.session.id}>{content(child)}</span>)}</div>
    {children.slice(0, expanded ? children.length : visible).map(child => <button className="team-member hv-sub" key={child.session.id} disabled={!onOpen} onClick={() => onOpen?.(child.session.id)} title={`${child.session.title || 'Child session'} · ${teamState(child.session).label} · ${compactTokens(child.session.tokens ?? 0)} tokens`}>{content(child)}</button>)}
    {visible < children.length ? <button className="team-more team-link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Less' : `+${children.length - visible}`}</button> : null}
  </div>;
}

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
  const requests = approvals.map(approval => <ApprovalLine key={`${approval.session}/${approval.request}`} approval={approval} title={sessions.find(s => s.id === approval.session)?.title || 'Child session'} />);
  return <section className="team-context" aria-label="Team">
    {details.team && details.parent ? <nav className="team-breadcrumb" aria-label="Team breadcrumb">
      <div className="team-breadcrumb-path"><Users size={12} /><span>Team</span><ChevronRight size={11} /><button className="team-link team-ellipsis" disabled={!onOpen} aria-label={`Back to ${parent?.title || 'parent'}`} onClick={() => onOpen?.(details.parent!)}>{parent?.title || 'Parent'}</button><ChevronRight size={11} /><span className="team-ellipsis" title={details.title || undefined}>{details.title || 'Child'}</span></div>
      {details.parentless ? <span className="team-parentless" title={parentlessHelp}><span className="team-dot team-tone-amber" />Parentless</span> : null}
    </nav> : null}
    {node?.children.length ? <div className="team-strip"><span className="team-strip-label"><Users size={12} />Team</span><Roster children={node.children} onOpen={onOpen} /><span className="team-strip-total" title={`Team tokens including archived children · Parent ${compactTokens(details.tokens ?? 0)} tokens`}>{compactTokens(node.tokens)} total</span></div> : null}
    {approvals.length > 1 ? <details className="team-requests"><summary title={approvalHelp}><span className="team-dot team-tone-amber" />{approvals.length} approvals waiting on parent<ChevronRight size={10} /></summary>{requests}</details> : requests}
  </section>;
}
