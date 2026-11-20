import { getSession, hasPendingApproval, sessionActivityState } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';

export function restoreHandoffState(ctx: DispatchCtx, session: string, cancelled = false): void {
  const current = getSession(ctx.db, session);
  if (!current || current.archived || current.handed_off) return;
  const activity = sessionActivityState(ctx.db, session);
  const interrupted = cancelled && ['running', 'starting', 'retrying', 'awaiting_input'].includes(activity);
  const state = interrupted ? 'interrupted'
    : hasPendingApproval(ctx.db, session) || ctx.teamApprovals.waiting(session) ? 'awaiting_approval' : activity;
  if (current.state !== state) ctx.record(session, 'state', { state });
}
