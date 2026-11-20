import { replay } from '@ormicode/journal';
import type { SessionRow } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';

export function sessionStatus(ctx: Pick<DispatchCtx, 'db' | 'teamApprovals' | 'teamLifecycle'>, session: SessionRow): { state: string; turnCompleted: boolean } {
  let turnCompleted = false;
  let turnFailed = false;
  for (const event of replay(ctx.db, session.id)) {
    if (event.kind === 'turn_start' || event.kind === 'state' && JSON.parse(event.payload).reason === 'prompt_dispatch') {
      turnCompleted = false;
      turnFailed = false;
    } else if (event.kind === 'error' && !turnCompleted) turnFailed = true;
    else if (event.kind === 'turn_end') turnCompleted = true;
  }
  const state = session.handed_off ? session.archived ? 'archived' : 'done'
    : ctx.teamApprovals.waiting(session.id) ? 'awaiting_approval' : ctx.teamLifecycle.state(session);
  return { state: state === 'idle' && turnCompleted && turnFailed ? 'failed' : state, turnCompleted };
}
