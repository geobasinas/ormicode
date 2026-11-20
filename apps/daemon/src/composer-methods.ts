import type { Client, DispatchCtx } from './dispatch.ts';
import { getDraft, getSession, setDraft } from '@ormicode/session-store';
import { promptHistory } from './prompt-history.ts';

export async function composerMethod(
  ctx: DispatchCtx,
  client: Client,
  id: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  if (method === 'session.commands') {
    const session = String(body.session);
    if (!getSession(ctx.db, session)) return client.link.replyError(id, 'session.not_found', session);
    await ctx.ensureWorker(session);
    const frame = await ctx.toWorker(session, 'worker.commands', {});
    if (frame?.type === 'res') return client.link.reply(id, { commands: frame.body.commands ?? [] });
    return client.link.replyError(id, 'agent.failed', 'Could not discover agent commands');
  }
  if (method === 'session.draft.get')
    return client.link.reply(id, { text: getDraft(ctx.db, String(body.session)) });
  if (method === 'session.draft.set') {
    setDraft(ctx.db, String(body.session), String(body.text));
    return client.link.reply(id, { saved: true });
  }
  if (method === 'prompts.history') {
    const project = typeof body.project === 'string' ? body.project : undefined;
    const items = promptHistory(ctx.db, { project, query: typeof body.query === 'string' ? body.query : '', limit: Number(body.limit ?? 50) });
    return client.link.reply(id, { items });
  }
}
