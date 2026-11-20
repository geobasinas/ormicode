import { getSession, hasPendingApproval, sessionActivityState } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';
import { handoffInProgress } from './handoff-transition.ts';

export function restoreHandoffState(ctx: DispatchCtx, session: string, options: { cancelled?: boolean; allowHandoffs?: boolean } = {}): void {
  const current = getSession(ctx.db, session);
  if (!current || current.archived || current.handed_off || handoffInProgress(ctx.db, session)) return;
  const activity = sessionActivityState(ctx.db, session);
  const interrupted = options.cancelled && ['running', 'starting', 'retrying', 'awaiting_input'].includes(activity);
  const approvals = { includeHandoffs: !options.allowHandoffs };
  const waiting = !['paused_rate_limited', 'interrupted', 'failed', 'done', 'archived'].includes(activity)
    && (hasPendingApproval(ctx.db, session, approvals) || ctx.teamApprovals.waiting(session, approvals));
  const state = interrupted ? 'interrupted'
    : waiting ? 'awaiting_approval' : activity;
  if (current.state !== state) ctx.record(session, 'state', { state });
}
