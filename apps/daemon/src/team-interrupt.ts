import { setTimeout } from 'node:timers/promises';
import { getSession, sessionActivityState } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';
import { expireHandoffApprovals } from './handoff-dispatch.ts';
import { restoreHandoffState } from './handoff-state.ts';

export async function interrupt(ctx: DispatchCtx, session: string, options: { timeoutMs?: number; cancelHandoffs?: boolean } = {}): Promise<void> {
  const { timeoutMs = 5000, cancelHandoffs = false } = options;
  const busy = () => {
    const state = getSession(ctx.db, session)?.state;
    return ['running', 'starting', 'retrying', 'awaiting_input', 'awaiting_approval'].includes(
      state === 'awaiting_approval' ? sessionActivityState(ctx.db, session) : state ?? '');
  };
  const abort = async () => {
    if (!busy()) return;
    const result = await ctx.toWorker(session, 'worker.abort', { preserveHandoffs: !cancelHandoffs });
    const deadline = Date.now() + timeoutMs;
    while (busy()) {
      if (Date.now() >= deadline)
        throw new Error(!result || result.type === 'err' ? 'child could not be interrupted' : 'child did not finish interrupting');
      await setTimeout(10);
    }
  };
  if (cancelHandoffs) { await abort(); expireHandoffApprovals(ctx, session, 'cancelled'); }
  else {
    await ctx.teamLifecycle.preserveHandoffs(session, abort);
    restoreHandoffState(ctx, session, { allowHandoffs: true });
  }
}
