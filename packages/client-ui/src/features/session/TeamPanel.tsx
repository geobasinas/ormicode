import { Users, ArrowLeft, ShieldCheck } from 'lucide-react';
import type { SessionDetails } from './useSession.ts';
import { useSessions } from './useSessions.ts';
import { sessionForest, type SessionNode } from './team-tree.ts';
import { compactTokens } from '../../lib/format.ts';

const link = { border: 0, background: 'transparent', color: 'var(--text-label)', font: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left' as const };

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
  return <section aria-label="Team" style={{ flexShrink: 0, maxHeight: '38%', overflow: 'auto', borderBottom: '1px solid var(--line-card)', color: 'var(--text-secondary)', fontSize: 11 }}>
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px var(--space-5)', display: 'grid', gap: 8 }}>
      {details.team && details.parent ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={link} disabled={!onOpen} onClick={() => onOpen?.(details.parent!)}><ArrowLeft size={11} style={{ verticalAlign: 'middle' }} /> Back to {parent?.title || 'parent'}</button>
        {details.parentless ? <span style={{ color: 'var(--accent-amber)' }}>Parentless · still running independently</span> : null}
      </div> : null}
      {node?.children.length ? <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Users size={13} /><strong style={{ color: 'var(--text-label)' }}>Team</strong><span>{compactTokens(node.tokens)} tokens total</span><span>· parent {compactTokens(details.tokens ?? 0)}</span></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{node.children.map(child => <button key={child.session.id} style={link} disabled={!onOpen} onClick={() => onOpen?.(child.session.id)}>
          {child.session.title || child.session.id.slice(0, 12)} · {compactTokens(child.session.tokens ?? 0)} tokens{child.session.parentless ? ' · Parentless' : ''}
        </button>)}</div>
      </> : null}
      {approvals.length ? <div aria-label="Parent approval inbox" style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--line-card)' }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-label)' }}><ShieldCheck size={13} />Parent approval inbox · {approvals.length}</strong>
        {approvals.map(approval => <div key={`${approval.session}/${approval.request}`}>
          <button style={link} disabled={!onOpen} onClick={() => onOpen?.(approval.session)}>{sessions.find(s => s.id === approval.session)?.title || approval.session.slice(0, 12)}</button> · {approval.tool}
          {approval.input !== undefined ? <pre style={{ margin: '4px 0', maxHeight: 70, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 10.5 }}>{JSON.stringify(approval.input, null, 2)}</pre> : null}
          <span>Waiting for parent · {approval.options.map(o => o.label).join(' / ')} · once only</span>
        </div>)}
        <span>The parent answers with team_approve. These requests do not need your approval.</span>
      </div> : null}
    </div>
  </section>;
}
