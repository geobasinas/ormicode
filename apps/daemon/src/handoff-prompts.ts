import { transferQueuedPrompts } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';
import { queueEventItems } from './prompt-delivery.ts';

export function transferHandoffPrompts(ctx: DispatchCtx, from: string, to: string): void {
  if (from === to) return;
  const moved = transferQueuedPrompts(ctx.db, from, to);
  const held = ctx.heldPrompts.get(from);
  if (held?.length) ctx.heldPrompts.set(to, [...(ctx.heldPrompts.get(to) ?? []), ...held]);
  ctx.heldPrompts.delete(from);
  if (ctx.paused.delete(from)) ctx.paused.add(to);
  if (moved) for (const session of [from, to]) ctx.record(session, 'queue_changed', { items: queueEventItems(ctx.db, session) });
}
