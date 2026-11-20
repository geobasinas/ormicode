import { answerTeamUserMessage, pendingQuestions } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';

export function expireHandoffQuestions(ctx: Pick<DispatchCtx, 'db' | 'record'>, session: string): void {
  for (const request of pendingQuestions(ctx.db, session)) {
    answerTeamUserMessage(ctx.db, request);
    ctx.record(session, 'interaction_expired', { request, reason: 'handed_off', answerable: false });
  }
}
