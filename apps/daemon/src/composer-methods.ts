import type { Client, DispatchCtx } from './dispatch.ts';
import { getDraft, getSession, listSessions, setDraft } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';

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
    const query = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
    const limit = Number(body.limit ?? 50);
    const prompts = [...listSessions(ctx.db), ...listSessions(ctx.db, true)]
      .filter(session => !project || session.project === project)
      .flatMap(session => replay(ctx.db, session.id)
        .filter(event => event.kind === 'prompt')
        .flatMap(event => {
          const payload = JSON.parse(event.payload) as { text?: unknown };
          const text = typeof payload.text === 'string' ? payload.text.trim() : '';
          if (!text || !text.toLowerCase().includes(query)) return [];
          return [{ text, createdAt: event.ts, session: session.id, project: session.project, seq: event.seq }];
        }))
      .sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);
    const seen = new Set<string>();
    const items = prompts.filter(item => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    }).slice(0, limit).map(({ text, createdAt, session, project: path }) => ({
      text, createdAt, session, project: path,
    }));
    return client.link.reply(id, { items });
  }
}
