import { setTimeout } from 'node:timers/promises';
import { getSession } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';

export async function interrupt(ctx: DispatchCtx, session: string, timeoutMs = 5000): Promise<void> {
  const busy = () => ['running', 'starting', 'retrying', 'awaiting_input', 'awaiting_approval'].includes(getSession(ctx.db, session)?.state ?? '');
  if (!busy()) return;
  const result = await ctx.toWorker(session, 'worker.abort', {});
  const deadline = Date.now() + timeoutMs;
  while (busy()) {
    if (Date.now() >= deadline)
      throw new Error(!result || result.type === 'err' ? 'child could not be interrupted' : 'child did not finish interrupting');
    await setTimeout(10);
  }
}
