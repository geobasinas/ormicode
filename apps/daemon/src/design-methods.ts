import { realpathSync } from 'node:fs';
import { getSession } from '@ormicode/session-store';
import type { DesignOperation } from '@ormicode/protocol';
import type { Client, DispatchCtx } from './dispatch.ts';
import { createDesign, designResult, DesignError, getDesign, listDesigns, updateDesign } from './design-store.ts';
import { recentDesignEdits, worktreeDesignSessions } from './design-activity.ts';
import { actorFor, frameVersions } from './design-review.ts';

export function designMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): void {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  try {
    const root = realpathSync(row.cwd);
    const peers = worktreeDesignSessions(ctx.db, root);
    if (method === 'design.mentionable') return client.link.reply(id, { sessions: peers.slice(0, 100).map(other => ({ id: other.id, ...(other.title === null ? {} : { title: other.title }), vendor: other.vendor })) });
    if (method === 'design.list') return client.link.reply(id, { boards: listDesigns(root) });
    const slug = String(body.slug);
    if (method === 'design.frameVersions') return client.link.reply(id, frameVersions(getDesign(root, slug), String(body.frameId)));
    if (method === 'design.get') return client.link.reply(id, designResult(getDesign(root, slug)));
    if (method === 'design.history') return client.link.reply(id, { history: designResult(getDesign(root, slug)).history });
    if (method === 'design.activity') return client.link.reply(id, { edits: recentDesignEdits(ctx.db, root, slug) });
    if (Buffer.byteLength(JSON.stringify(body)) > 192 * 1024) throw new DesignError('design.too_large', 'Request exceeds 192 KiB');
    const stored = method === 'design.create' ? createDesign(root, slug, String(body.name))
      : updateDesign(root, slug, Number(body.expectedRevision), method === 'design.restore' ? Number(body.targetRevision) : body.operations as DesignOperation[], { actor: actorFor(client, session), mentionable: new Set(peers.map(other => other.id)), history: [] });
    for (const other of peers) {
      ctx.record(other.id, 'design_changed', {
        slug, revision: stored.document.revision, originSession: session,
        ...(client.device === 'mcp' ? { source: 'mcp' } : {}),
        summary: stored.history.at(-1)?.summary ?? 'Create board',
      });
    }
    if (method === 'design.update') {
      const before = stored.history.at(-1)?.document;
      const oldIds = new Set(before?.comments.flatMap(comment => [comment.id, ...(comment.replies ?? []).map(reply => reply.id)]));
      for (const comment of stored.document.comments) {
        for (const item of [comment, ...(comment.replies ?? [])]) {
          if (oldIds.has(item.id)) continue;
          for (const target of new Set(item.mentions ?? [])) {
            if (target !== session) ctx.record(target, 'design_mention', { slug, commentId: comment.id, revision: stored.document.revision, from: session, excerpt: item.text });
          }
        }
      }
    }
    return client.link.reply(id, designResult(stored));
  } catch (error) {
    return client.link.replyError(id, error instanceof DesignError ? error.code : 'design.failed', error instanceof Error ? error.message : String(error));
  }
}
