import type { Client, DispatchCtx } from './dispatch.ts';
import { ServiceError } from './services.ts';

export async function serviceMethod(
  ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>,
): Promise<void> {
  const session = String(body.session);
  try {
    if (method === 'service.list') return client.link.reply(id, await ctx.services.list(session));
    if (method === 'service.start' || method === 'service.stop' || method === 'service.restart') {
      const name = String(body.service);
      const service = method === 'service.start' ? await ctx.services.start(session, name)
        : method === 'service.stop' ? await ctx.services.stop(session, name)
          : await ctx.services.restart(session, name);
      return client.link.reply(id, { service });
    }
    if (method === 'service.logs') {
      const after = typeof body.after === 'number' ? body.after : undefined;
      return client.link.reply(id, ctx.services.logs(session, String(body.service), after));
    }
    if (method === 'preview.url') {
      return client.link.reply(id, { url: await ctx.services.previewUrl(session, Number(body.port), String(body.path ?? '/')) });
    }
    if (method === 'preview.console') {
      return client.link.reply(id, ctx.services.previewConsole(session,
        typeof body.after === 'number' ? body.after : undefined, typeof body.limit === 'number' ? body.limit : undefined));
    }
    if (method === 'preview.consoleClear') {
      ctx.services.clearPreviewConsole(session);
      return client.link.reply(id, { cleared: true });
    }
  } catch (error) {
    if (error instanceof ServiceError) return client.link.replyError(id, error.code, error.message);
    return client.link.replyError(id, 'service.failed', error instanceof Error ? error.message : String(error));
  }
  return client.link.replyError(id, 'protocol.unimplemented', method);
}
