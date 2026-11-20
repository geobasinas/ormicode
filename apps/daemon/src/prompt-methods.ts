import { PromptInvalidError } from './prompt-context.ts';
import type { Client, DispatchCtx } from './dispatch.ts';
import { journalPrompt } from './prompt-recovery.ts';

export async function retryPrompt(
  ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>,
): Promise<void> {
  const session = String(body.session);
  try {
    const last = ctx.lastPrompt.get(session) ?? journalPrompt(ctx.db, session);
    if (!last) return client.link.replyError(id, 'session.not_found', 'no prompt to retry');
    const sent = await ctx.sendPrompt(session, last.text, last.images, {
      journal: false, context: last.context, attachments: last.attachments,
    });
    return sent ? client.link.reply(id, { accepted: true }) : client.link.replyError(id, 'agent.failed', 'worker rejected retry');
  } catch (error) {
    if (error instanceof PromptInvalidError) return client.link.replyError(id, 'prompt.invalid', error.message);
    throw error;
  }
}
