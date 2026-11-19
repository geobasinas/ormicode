import { realpathSync } from 'node:fs';
import { getSession, listSessions } from '@ormicode/session-store';
import type { DesignOperation } from '@ormicode/protocol';
import type { Client, DispatchCtx } from './dispatch.ts';
import { createDesign, designResult, DesignError, getDesign, listDesigns, updateDesign } from './design-store.ts';

export function designMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): void {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  try {
    const root = realpathSync(row.cwd);
    if (method === 'design.list') return client.link.reply(id, { boards: listDesigns(root) });
    const slug = String(body.slug);
    if (method === 'design.get') return client.link.reply(id, designResult(getDesign(root, slug)));
    if (method === 'design.history') return client.link.reply(id, { history: designResult(getDesign(root, slug)).history });
    if (Buffer.byteLength(JSON.stringify(body)) > 192 * 1024) throw new DesignError('design.too_large', 'Request exceeds 192 KiB');
    const stored = method === 'design.create' ? createDesign(root, slug, String(body.name))
      : updateDesign(root, slug, Number(body.expectedRevision), method === 'design.restore' ? Number(body.targetRevision) : body.operations as DesignOperation[], session);
    for (const other of [...listSessions(ctx.db), ...listSessions(ctx.db, true)]) {
      let same = false;
      try { same = realpathSync(other.cwd) === root; } catch { /* Removed worktree. */ }
      if (same) ctx.record(other.id, 'design_changed', { slug, revision: stored.document.revision });
    }
    return client.link.reply(id, designResult(stored));
  } catch (error) {
    return client.link.replyError(id, error instanceof DesignError ? error.code : 'design.failed', error instanceof Error ? error.message : String(error));
  }
}
