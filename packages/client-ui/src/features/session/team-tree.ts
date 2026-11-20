import type { SessionSummary } from './useSessions.ts';
import { USER_WAIT_STATES } from './waiting.ts';

export interface SessionNode { session: SessionSummary; children: SessionNode[]; tokens: number }
export const needsUser = (session: SessionSummary) => !session.delegatedApproval && USER_WAIT_STATES.has(session.state);
const rank = (s: SessionSummary) => needsUser(s) ? 0 : ['starting', 'running', 'retrying'].includes(s.state) ? 1 : 2;

export function sessionForest(sessions: SessionSummary[], query = ''): SessionNode[] {
  const nodes = new Map(sessions.filter(s => s.state !== 'archived').map(session => [session.id, { session, children: [], tokens: Math.max(0, session.tokens ?? 0) } as SessionNode]));
  const roots: SessionNode[] = [];
  for (const node of nodes.values()) {
    const s = node.session, parent = s.team && s.parent ? nodes.get(s.parent) : undefined;
    const seen = new Set([s.id]);
    let ancestor = parent, cycle = false;
    while (ancestor) {
      if (seen.has(ancestor.session.id)) { cycle = true; break; }
      seen.add(ancestor.session.id);
      ancestor = ancestor.session.team && ancestor.session.parent ? nodes.get(ancestor.session.parent) : undefined;
    }
    if (parent && !cycle) parent.children.push(node); else roots.push(node);
  }
  const sort = (list: SessionNode[]) => {
    list.sort((a, b) => rank(a.session) - rank(b.session) || (b.session.updatedAt ?? 0) - (a.session.updatedAt ?? 0));
    for (const node of list) { sort(node.children); node.tokens = node.session.teamTokens ?? node.tokens + node.children.reduce((sum, child) => sum + child.tokens, 0); }
  };
  sort(roots);
  const q = query.trim().toLowerCase();
  const filter = (list: SessionNode[]): SessionNode[] => list.flatMap(node => {
    const s = node.session;
    if (!q || `${s.title ?? ''} ${s.project} ${s.vendor ?? ''} ${s.branch ?? ''}`.toLowerCase().includes(q)) return [node];
    const children = filter(node.children);
    return children.length ? [{ ...node, children }] : [];
  });
  return filter(roots);
}

export function containsSession(node: SessionNode, id?: string): boolean {
  return node.session.id === id || node.children.some(child => containsSession(child, id));
}
