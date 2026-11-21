import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { archiveSession, getSession, markSessionDeleted, releaseSessionPorts, unarchiveSession } from '@ormicode/session-store';
import { acquireWorkspace, releaseForSession } from '@ormicode/leases';
import type { Client, DispatchCtx } from './dispatch.ts';
import { stopSessionWorker } from './abort-session.ts';
import { scratchWorkspaceInUse } from './scratch-methods.ts';
import { ormicodeDir, sessionLogDir } from './socket.ts';

/** session.archive / session.delete hide a session (delete also drops its files); session.unarchive brings it back. */
export async function archiveMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  const { db } = ctx;
  const session = String(body.session);
  if (method === 'session.unarchive') {
    const row = getSession(db, session);
    if (!row) return client.link.replyError(id, 'session.not_found', session);
    if (!row.archived) return client.link.replyError(id, 'session.not_archived', session);
    if (!existsSync(row.cwd)) return client.link.replyError(id, 'workspace.not_found', `workspace directory not found: ${row.cwd}`);
    // Archive released the workspace lease; take it back unless a live session owns it now.
    // Handed-off sessions gave their workspace away and teammates share their owner's scratch folder.
    const sharedScratch = row.project === 'scratch' && row.cwd !== join(ormicodeDir(), 'scratch', session);
    const lease = row.handed_off || sharedScratch ? {} : acquireWorkspace(db, row.cwd, session, row.machine);
    if (lease.conflict) return client.link.replyError(id, 'lease.conflict', `workspace held by ${lease.conflict}`);
    unarchiveSession(db, session);
    ctx.record(session, 'state', { state: row.handed_off ? 'done' : 'idle' });
    ctx.sessionsChanged();
    return client.link.reply(id, { archived: false });
  }
  if (method === 'session.delete') await ctx.agentBrowser.deleteSession(session);
  else await ctx.agentBrowser.closeSession(session);
  await ctx.services.stopSession(session); await stopSessionWorker(ctx, session);
  archiveSession(db, session);
  if (method === 'session.delete') markSessionDeleted(db, session);
  ctx.record(session, 'state', { state: 'archived' });
  ctx.teamLifecycle.unavailable(session);
  releaseForSession(db, session);
  // Only the scratch folder owner may remove it, never while teammates still use it.
  const row = getSession(db, session);
  const scratchRoot = join(ormicodeDir(), 'scratch');
  if (method === 'session.delete' && row?.cwd === join(scratchRoot, session) && !scratchWorkspaceInUse(db, row.cwd, session)) {
    try { rmSync(row.cwd, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (method === 'session.delete') {
    releaseSessionPorts(db, session);
    try { rmSync(sessionLogDir(session), { recursive: true, force: true }); } catch { /* best effort */ }
    void ctx.checkpoints.remove(session).catch(() => undefined);
  }
  ctx.sessionsChanged();
  return client.link.reply(id, method === 'session.delete' ? { deleted: true } : { archived: true });
}
