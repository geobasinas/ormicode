import { account, declared, NAME } from '@ormicode/secrets';
import type { Client, DispatchCtx } from './dispatch.ts';

export function secretMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): void {
  const { keyring } = ctx.secrets;
  const project = typeof body.project === 'string' ? body.project : undefined;
  const name = String(body.name ?? '');
  if (method === 'secret.list') return client.link.reply(id, ctx.secrets.names(project));
  if (method === 'secret.status') {
    const names = declared(String(body.project));
    return client.link.reply(id, { keyring: keyring.kind, declared: names, missing: ctx.secrets.missing(String(body.project)) });
  }
  if (!NAME.test(name)) return client.link.replyError(id, 'secrets.bad_name', 'names are UPPER_SNAKE_CASE');
  try {
    if (method === 'secret.set') keyring.set(account(name, project), String(body.value));
    else if (method === 'secret.delete') keyring.delete(account(name, project));
    else return client.link.replyError(id, 'method.unknown', method);
  } catch (e) {
    return client.link.replyError(id, (e as { code?: string }).code ?? 'secrets.failed', (e as Error).message);
  }
  ctx.secrets.indexName(name, project, method === 'secret.set');
  ctx.secrets.log(name, method === 'secret.set' ? 'set' : 'delete');
  return client.link.reply(id, { ok: true });
}
