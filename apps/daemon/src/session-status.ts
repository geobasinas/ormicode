import { replay } from '@ormicode/journal';
import type { SessionRow, Store } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';

type TurnStatus = { seq: number; turnCompleted: boolean; turnFailed: boolean };
const turns = new WeakMap<Store, Map<string, TurnStatus>>();

export function sessionStatus(ctx: Pick<DispatchCtx, 'db' | 'teamApprovals' | 'teamLifecycle'>, session: SessionRow): { state: string; turnCompleted: boolean } {
  let cache = turns.get(ctx.db);
  if (!cache) turns.set(ctx.db, cache = new Map());
  const previous = cache.get(session.id);
  const turn = previous && previous.seq <= session.last_seq ? previous : { seq: 0, turnCompleted: false, turnFailed: false };
  for (const event of turn.seq === session.last_seq ? [] : replay(ctx.db, session.id, turn.seq)) {
    if (event.kind === 'turn_start' || event.kind === 'state' && JSON.parse(event.payload).reason === 'prompt_dispatch') {
      turn.turnCompleted = false;
      turn.turnFailed = false;
    } else if (event.kind === 'error' && !turn.turnCompleted) turn.turnFailed = true;
    else if (event.kind === 'turn_end') turn.turnCompleted = true;
    turn.seq = event.seq;
  }
  cache.set(session.id, turn);
  const state = session.handed_off ? session.archived ? 'archived' : 'done'
    : ctx.teamApprovals.waiting(session.id) ? 'awaiting_approval' : ctx.teamLifecycle.state(session);
  return { state: state === 'idle' && turn.turnCompleted && turn.turnFailed ? 'failed' : state, turnCompleted: turn.turnCompleted };
}
