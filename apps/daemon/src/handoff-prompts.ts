import { getSession, listQueuedPrompts, transferQueuedPrompts } from '@ormicode/session-store';
import type { DispatchCtx } from './dispatch.ts';
import { queueEventItems } from './prompt-delivery.ts';
import { expandPrompt, PromptInvalidError, validatePrompt, type PromptAppendix } from './prompt-context.ts';

export function validateHandoffPrompts(ctx: DispatchCtx, from: string, to: string): void {
  const target = getSession(ctx.db, to)!;
  const prompts = [
    ...(ctx.heldPrompts.get(from) ?? []).map((prompt, index) => ({ prompt, label: `Held prompt ${index + 1}` })),
    ...listQueuedPrompts(ctx.db, from).map(prompt => ({ prompt, label: `Queued prompt ${prompt.id}` })),
  ];
  for (const { prompt, label } of prompts) {
    try {
      if ('error' in prompt && prompt.error) throw new Error(String(prompt.error));
      validatePrompt(target.cwd, prompt);
    } catch (error) {
      throw new PromptInvalidError(`${label} cannot be transferred to ${to}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function resolveContext<T extends PromptAppendix>(ctx: DispatchCtx, session: string, prompt: T): T {
  const sourceKinds = ['notes', 'terminal', 'console', 'diff'];
  const context = prompt.context?.filter(item => sourceKinds.includes(item.kind));
  if (!context?.length) return prompt;
  const source = getSession(ctx.db, session)!;
  const prepared = expandPrompt({
    cwd: source.cwd, baseCommit: source.base_commit, session, notesDir: ctx.notesDir,
    terminalOutput: (id, terminal) => ctx.terminals.recentOutput(id, terminal),
    previewEntries: (id, ids) => ctx.services.previewEntries(id, ids),
  }, { text: prompt.text, context });
  return { ...prompt, text: prepared.text, context: prompt.context?.filter(item => !sourceKinds.includes(item.kind)) };
}

export function transferHandoffPrompts(ctx: DispatchCtx, from: string, to: string): void {
  if (from === to) return;
  validateHandoffPrompts(ctx, from, to);
  const held = ctx.heldPrompts.get(from)?.map(prompt => resolveContext(ctx, from, prompt));
  const moved = transferQueuedPrompts(ctx.db, from, to, item => resolveContext(ctx, from, item));
  if (held?.length) ctx.heldPrompts.set(to, [...(ctx.heldPrompts.get(to) ?? []), ...held]);
  ctx.heldPrompts.delete(from);
  if (ctx.paused.delete(from)) ctx.paused.add(to);
  if (moved) for (const session of [from, to]) ctx.record(session, 'queue_changed', { items: queueEventItems(ctx.db, session) });
}
