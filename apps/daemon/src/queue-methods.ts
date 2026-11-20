import { newId } from '@ormicode/protocol';
import {
  addQueuedPrompt, getSession, listQueuedPrompts, moveQueuedPrompt, removeQueuedPrompt, updateQueuedPrompt,
} from '@ormicode/session-store';
import type { PromptAttachment, PromptContext } from '@ormicode/protocol';
import type { Client, DispatchCtx } from './dispatch.ts';
import { validatePrompt } from './prompt-context.ts';
import { shouldResetUiCheckFollowups } from './ui-check.ts';
import { handoffTargetError } from './handoff-transition.ts';

export function queueMethod(
  ctx: DispatchCtx,
  client: Client,
  id: string,
  method: string,
  body: Record<string, unknown>,
): void {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  const error = handoffTargetError(ctx.db, session);
  if (error && method !== 'session.queue.list') return client.link.replyError(id, 'session.busy', error);
  switch (method) {
    case 'session.queue.add': {
      try {
        validatePrompt(row.cwd, { text: String(body.text), context: body.context as PromptContext[] | undefined, attachments: body.attachments as PromptAttachment[] | undefined });
      } catch (error) {
        return client.link.replyError(id, 'prompt.invalid', error instanceof Error ? error.message : String(error));
      }
      const queued = {
        id: newId('q'),
        text: String(body.text),
        createdAt: Date.now(),
        ...(body.images ? { images: body.images as never[] } : {}),
        ...(body.context ? { context: body.context as PromptContext[] } : {}),
        ...(body.attachments ? { attachments: body.attachments as PromptAttachment[] } : {}),
      };
      addQueuedPrompt(ctx.db, session, queued);
      if (shouldResetUiCheckFollowups(client.device)) ctx.resetUiCheckFollowups(session);
      ctx.record(session, 'queue_changed', { items: queueEventItems(ctx.db, session) });
      void ctx.drainQueue(session);
      return client.link.reply(id, { id: queued.id });
    }
    case 'session.queue.list':
      return client.link.reply(id, { items: queueEventItems(ctx.db, session) });
    case 'session.queue.update':
      if (!updateQueuedPrompt(ctx.db, session, String(body.id), String(body.text)))
        return client.link.replyError(id, 'queue.item_not_found', String(body.id));
      ctx.record(session, 'queue_changed', { items: queueEventItems(ctx.db, session) });
      void ctx.drainQueue(session);
      return client.link.reply(id, { updated: true });
    case 'session.queue.remove':
      if (!removeQueuedPrompt(ctx.db, session, String(body.id)))
        return client.link.replyError(id, 'queue.item_not_found', String(body.id));
      ctx.record(session, 'queue_changed', { items: queueEventItems(ctx.db, session) });
      void ctx.drainQueue(session);
      return client.link.reply(id, { removed: true });
    case 'session.queue.move':
      if (!moveQueuedPrompt(ctx.db, session, String(body.id), Number(body.index)))
        return client.link.replyError(id, 'queue.item_not_found', String(body.id));
      ctx.record(session, 'queue_changed', { items: queueEventItems(ctx.db, session) });
      void ctx.drainQueue(session);
      return client.link.reply(id, { moved: true });
  }
}

function queueEventItems(db: DispatchCtx['db'], session: string) {
  return listQueuedPrompts(db, session).map(item => ({
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    ...(item.images?.length ? { images: item.images.length } : {}),
    ...(item.error ? { error: item.error } : {}),
    ...(item.actor ? { actor: item.actor } : {}),
  }));
}
