import { pendingQuestions, sessionActivityState } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';
import { expireHandoffApprovals } from './handoff-dispatch.ts';

export async function abortSession(ctx: DispatchCtx, session: string): Promise<boolean> {
  if (!['starting', 'running', 'retrying', 'awaiting_approval', 'awaiting_input', 'paused_rate_limited'].includes(sessionActivityState(ctx.db, session))
    && !pendingQuestions(ctx.db, session).length) return false;
  expireHandoffApprovals(ctx, session, 'cancelled');
  ctx.interactions.unavailable(session, 'user_abort');
  await ctx.stopWorker(session, true);
  ctx.interactions.unavailable(session, 'user_abort');
  const pending = ctx.db.prepare(`SELECT json_extract(q.payload, '$.request') AS request FROM events q
    WHERE q.session = ? AND q.kind IN ('approval_request', 'question_request') AND NOT EXISTS (
      SELECT 1 FROM events r WHERE r.session = q.session AND r.seq > q.seq
      AND r.kind IN ('approval_decision', 'question_answer', 'interaction_expired')
      AND json_extract(r.payload, '$.request') = json_extract(q.payload, '$.request'))`).all(session) as { request: string }[];
  const requests = new Set([...pending.map(({ request }) => request), ...pendingQuestions(ctx.db, session)]);
  for (const request of requests) ctx.record(session, 'interaction_expired', { request, reason: 'user_abort', answerable: false });
  ctx.record(session, 'interrupted', { reason: 'user_abort' });
  await ctx.drainQueue(session, true, true);
  return true;
}
