import type { Client, DispatchCtx } from './dispatch.ts';
import { ServiceError } from './services.ts';
import { destination, existingPreviewPorts, type BrowserServices } from './browser-methods.ts';
import { BrowserError } from './agent-browser.ts';
import { PREVIEW_FETCH_CHUNK_BYTES } from './preview-fetch.ts';

const REQUEST_BODY_LIMIT = 10 * 1024 * 1024;

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
    if (method === 'preview.fetch') {
      const listed = await ctx.services.list(session) as unknown as BrowserServices;
      const target = destination(session, { port: Number(body.port), path: body.path }, listed);
      if (!existingPreviewPorts(listed).has(target.port))
        throw new BrowserError('preview.not_allowed', 'Port is not an existing preview for this session.');
      const methodName = String(body.method).toUpperCase();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(methodName))
        throw new BrowserError('preview.not_allowed', 'HTTP method is not allowed for preview fetch.');
      const encoded = typeof body.body === 'string' ? body.body : '';
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, ''))
        throw new BrowserError('preview.not_allowed', 'Request body must be base64.');
      if (bytes.length > REQUEST_BODY_LIMIT)
        throw new BrowserError('preview.too_large', 'Preview request body exceeds the 10 MiB limit.');
      const headers = body.headers as Record<string, string>;
      return client.link.reply(id, await ctx.services.previewFetch(client.device, session, target.port, methodName, target.path, headers, bytes));
    }
    if (method === 'preview.fetchMore') {
      return client.link.reply(id, ctx.services.previewFetchMore(client.device, String(body.handle)));
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
    if (error instanceof BrowserError) return client.link.replyError(id, error.code === 'browser.not_allowed' ? 'preview.not_allowed' : error.code, error.message);
    if (error instanceof ServiceError) return client.link.replyError(id, error.code, error.message);
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
      return client.link.replyError(id, error.code, error instanceof Error ? error.message : String(error));
    return client.link.replyError(id, 'service.failed', error instanceof Error ? error.message : String(error));
  }
  return client.link.replyError(id, 'protocol.unimplemented', method);
}
