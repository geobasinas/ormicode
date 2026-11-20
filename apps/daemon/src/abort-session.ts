import { sessionActivityState } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';
import { expireHandoffApprovals } from './handoff-dispatch.ts';

export async function abortSession(ctx: DispatchCtx, session: string): Promise<boolean> {
  if (!['starting', 'running', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited'].includes(sessionActivityState(ctx.db, session))) return false;
  expireHandoffApprovals(ctx, session, 'cancelled');
  await ctx.stopWorker(session, true);
  const pending = ctx.db.prepare(`SELECT json_extract(q.payload, '$.request') AS request FROM events q
    WHERE q.session = ? AND q.kind IN ('approval_request', 'question_request') AND NOT EXISTS (
      SELECT 1 FROM events r WHERE r.session = q.session AND r.seq > q.seq
      AND r.kind IN ('approval_decision', 'question_answer', 'interaction_expired')
      AND json_extract(r.payload, '$.request') = json_extract(q.payload, '$.request'))`).all(session) as { request: string }[];
  for (const { request } of pending) ctx.record(session, 'interaction_expired', { request, reason: 'user_abort', answerable: false });
  ctx.record(session, 'interrupted', { reason: 'user_abort' });
  await ctx.drainQueue(session, true, true);
  return true;
}
