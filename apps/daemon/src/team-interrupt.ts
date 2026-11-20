import { setTimeout } from 'node:timers/promises';
import { getSession, sessionActivityState } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';
import { expireHandoffApprovals } from './handoff-dispatch.ts';

export async function interrupt(ctx: DispatchCtx, session: string, timeoutMs = 5000): Promise<void> {
  const busy = () => {
    const state = getSession(ctx.db, session)?.state;
    return ['running', 'starting', 'retrying', 'awaiting_input', 'awaiting_approval'].includes(
      state === 'awaiting_approval' ? sessionActivityState(ctx.db, session) : state ?? '');
  };
  if (!busy()) { expireHandoffApprovals(ctx, session, 'cancelled'); return; }
  const result = await ctx.toWorker(session, 'worker.abort', {});
  const deadline = Date.now() + timeoutMs;
  while (busy()) {
    if (Date.now() >= deadline)
      throw new Error(!result || result.type === 'err' ? 'child could not be interrupted' : 'child did not finish interrupting');
    await setTimeout(10);
  }
  expireHandoffApprovals(ctx, session, 'cancelled');
}
