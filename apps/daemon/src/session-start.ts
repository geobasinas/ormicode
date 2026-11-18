import { newId } from '@ormicode/protocol';
import { acquireWorkspace } from '@ormicode/leases';
import { createSession, listSessions } from '@ormicode/session-store';
import { defaultBranch, resolveWorkspace, type ResolvedWorkspace, type WorkspaceChoice } from '@ormicode/git-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Client, DispatchCtx } from './dispatch.ts';
import { branchIsBusy } from './branch-busy.ts';
import { hasTransport } from './registry.ts';
import { ormicodeDir } from './socket.ts';

export async function startSession(
  ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>,
): Promise<void> {
  const vendor = String(body.vendor); const transport = String(body.transport);
  if (!hasTransport(vendor, transport)) return client.link.replyError(id, 'agent.unsupported', `${vendor}/${transport}`);
  const sessionId = newId('s');
  const project = String(body.project);
  const missing = ctx.secrets.missing(project);
  if (missing.length) return client.link.replyError(id, 'secrets.missing', `missing secrets: ${missing.join(', ')} (ormi secret set NAME --project ${project})`);
  const workspace = body.workspace as WorkspaceChoice | { kind: 'scratch' };
  let resolved: ResolvedWorkspace;
  if (workspace.kind === 'scratch') {
    resolved = { cwd: join(ormicodeDir(), 'scratch', sessionId) };
    mkdirSync(resolved.cwd, { recursive: true });
  } else {
    const busy = (branch: string) => branchIsBusy(ctx.db, project, branch, sessionId);
    const result = await resolveWorkspace(project, workspace, body.workspaceName as string | undefined, sessionId, busy);
    if ('err' in result) return client.link.replyError(id, result.err, result.detail ?? result.err);
    resolved = result;
    if (workspace.kind === 'existing') {
      const existingPath = resolved.worktree ?? resolved.cwd;
      const previous = [...listSessions(ctx.db, false), ...listSessions(ctx.db, true)]
        .sort((a, b) => b.updated_at - a.updated_at)
        .find(row => (row.worktree ?? row.cwd) === existingPath || row.cwd === existingPath);
      resolved.baseBranch = previous?.base_branch ?? defaultBranch(project) ?? undefined;
    }
  }
  const cwd = resolved.cwd;
  const machine = String(body.machine ?? 'm_local');
  const lease = acquireWorkspace(ctx.db, cwd, sessionId, machine);
  if (lease.conflict) return client.link.replyError(id, 'lease.conflict', `workspace held by ${lease.conflict}`);
  createSession(ctx.db, {
    id: sessionId, machine, project, vendor, transport, cwd,
    worktree: resolved.worktree, branch: resolved.branch,
    baseBranch: resolved.baseBranch, baseCommit: resolved.baseCommit,
    ...(body.model && body.model !== 'default' ? { model: String(body.model) } : {}),
    ...(body.effort && body.effort !== 'default' ? { effort: String(body.effort) } : {}),
    ...(body.mode && body.mode !== 'default' ? { mode: String(body.mode) } : {}),
    ...(body.agentCommand ? { agentCommand: String(body.agentCommand) } : {}),
    ...(body.agentArgs ? { agentArgs: body.agentArgs as string[] } : {}),
    ...(body.parent ? { parent: String(body.parent) } : {}),
  });
  for (const step of resolved.steps ?? []) ctx.record(sessionId, 'workspace_step', { ...step });
  ctx.spawnWorker(sessionId);
  client.link.reply(id, { session: sessionId });
}
