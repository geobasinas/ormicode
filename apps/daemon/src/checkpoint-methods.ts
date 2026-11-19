// checkpoint.* requests: list, diff, restore (files) and fork, over the
// per-session shadow repos owned by the supervisor's Checkpoints queue.
import { randomBytes } from 'node:crypto';
import { newId } from '@ormicode/protocol';
import { getSession, createSession } from '@ormicode/session-store';
import type { Client, DispatchCtx } from './dispatch.ts';
import { acquireWorkspace, releaseForSession } from '@ormicode/leases';
import { forkWorktree, removeWorktree } from '@ormicode/git-core';

const IN_TURN = new Set(['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying']);

export async function checkpointMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  const repo = ctx.checkpoints.repo(session);
  const missing = (cp: unknown) => client.link.replyError(id, 'checkpoint.not_found', String(cp));
  switch (method) {
    case 'checkpoint.list':
      return client.link.reply(id, { checkpoints: await repo.list() });
    case 'checkpoint.diff': {
      const from = await repo.find(String(body.from));
      if (!from) return missing(body.from);
      const to = body.to ? await repo.find(String(body.to)) : undefined;
      if (body.to && !to) return missing(body.to);
      return client.link.reply(id, { ...await repo.diff(from, to) });
    }
    case 'checkpoint.restore': {
      if (IN_TURN.has(row.state)) return client.link.replyError(id, 'checkpoint.busy', 'a turn is running; stop it first');
      const cp = await repo.find(String(body.id));
      if (!cp) return missing(body.id);
      await ctx.checkpoints.run(session, () => repo.restore(row.cwd, cp));
      if (body.mode === 'conversation') {
        await ctx.stopWorker(session);
        ctx.db.prepare('UPDATE sessions SET native_id = NULL, worker_pid = NULL WHERE id = ?').run(session);
        ctx.setRecapPending(session, cp.seq);
        ctx.record(session, 'conversation_rewound', { to: cp.seq, checkpoint: cp.id });
        return client.link.reply(id, { restored: true, id: cp.id, mode: 'conversation' });
      }
      ctx.record(session, 'checkpoint_restored', { id: cp.id, mode: 'files' });
      return client.link.reply(id, { restored: true, id: cp.id, mode: 'files' });
    }
    case 'checkpoint.fork': {
      const cp = await repo.find(String(body.id));
      if (!cp) return missing(body.id);
      const branch = body.branch ? String(body.branch) : `${row.branch ?? 'ormi'}-fork-${randomBytes(3).toString('hex')}`;
      const wt = forkWorktree(row.project, row.cwd, branch);
      if ('err' in wt) return client.link.replyError(id, wt.err, wt.detail ?? wt.err);
      const child = newId('s');
      try {
        await ctx.checkpoints.run(session, () => repo.writeTo(wt.dir, cp));
        const lease = acquireWorkspace(ctx.db, wt.dir, child, row.machine);
        if (lease.conflict) throw new Error(`workspace held by ${lease.conflict}`);
        createSession(ctx.db, {
          id: child, machine: row.machine, project: row.project, vendor: row.vendor, transport: row.transport,
          cwd: wt.dir, worktree: wt.dir, branch, baseBranch: row.branch ?? undefined, baseCommit: wt.commit, parent: session,
          ...(row.title ? { title: `${row.title} (fork)` } : {}),
          ...(row.model ? { model: row.model } : {}), ...(row.effort ? { effort: row.effort } : {}), ...(row.mode ? { mode: row.mode } : {}),
          ...(row.agent_command ? { agentCommand: row.agent_command } : {}),
          ...(row.agent_args ? { agentArgs: JSON.parse(row.agent_args) as string[] } : {}),
        });
      } catch (e) {
        releaseForSession(ctx.db, child);
        removeWorktree(row.project, wt.dir, branch);
        return client.link.replyError(id, 'checkpoint.fork_failed', e instanceof Error ? e.message : String(e));
      }
      ctx.spawnWorker(child);
      return client.link.reply(id, { session: child, branch, cwd: wt.dir, from: cp.id });
    }
  }
  return client.link.replyError(id, 'protocol.unimplemented', method);
}
