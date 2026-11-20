import { newId } from '@ormicode/protocol';
import { acquireWorkspace } from '@ormicode/leases';
import { createSession, getSession, listSessions, ownedTeam, releaseSessionPorts, setPendingPromptData, setSessionTeam } from '@ormicode/session-store';
import { defaultBranch, resolveWorkspace, type ResolvedWorkspace, type WorkspaceChoice } from '@ormicode/git-core';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Client, DispatchCtx } from './dispatch.ts';
import { branchIsBusy, mainCheckoutIsBusy } from './branch-busy.ts';
import { hasTransport } from './registry.ts';
import { ormicodeDir } from './socket.ts';
import { validatePrompt } from './prompt-context.ts';
import type { PromptAttachment, PromptContext } from '@ormicode/protocol';
import { allocateSessionPorts } from './session-ports.ts';
import { sessionEnvironment } from './session-env.ts';

export async function startSession(
  ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>, scratchCwd?: string,
): Promise<void> {
  if (body.parent && !body.team && (ownedTeam(ctx.db, String(body.parent)) || getSession(ctx.db, String(body.parent))?.team))
    return client.link.replyError(id, 'team.forbidden', 'team members must start children through team.spawn');
  const vendor = String(body.vendor); const transport = String(body.transport);
  if (!hasTransport(vendor, transport)) return client.link.replyError(id, 'agent.unsupported', `${vendor}/${transport}`);
  const sessionId = newId('s');
  const project = String(body.project);
  const workspace = body.workspace as WorkspaceChoice | { kind: 'scratch' };
  const sharedScratch = workspace.kind === 'scratch' && scratchCwd !== undefined;
  const directory = workspace.kind === 'scratch' ? scratchCwd : project;
  if (directory !== undefined) {
    let isDirectory = false;
    try { isDirectory = statSync(directory).isDirectory(); } catch { /* missing directory */ }
    if (!isDirectory) return client.link.replyError(id, 'workspace.not_found', `${sharedScratch ? 'workspace' : 'project'} directory not found: ${directory}`);
  }
  const missing = ctx.secrets.missing(project);
  if (missing.length) return client.link.replyError(id, 'secrets.missing', `missing secrets: ${missing.join(', ')} (ormi secret set NAME --project ${project})`);
  let ports: { base: number; count: 10 };
  try { ports = await allocateSessionPorts(ctx.db, sessionId); }
  catch (error) { return client.link.replyError(id, 'session.ports_unavailable', String(error)); }
  let resolved: ResolvedWorkspace;
  if (workspace.kind === 'scratch') {
    resolved = { cwd: scratchCwd ?? join(ormicodeDir(), 'scratch', sessionId) };
    try { mkdirSync(resolved.cwd, { recursive: true }); }
    catch (error) { releaseSessionPorts(ctx.db, sessionId); throw error; }
  } else {
    if (workspace.kind === 'checkout' && mainCheckoutIsBusy(ctx.db, project)) {
      releaseSessionPorts(ctx.db, sessionId);
      return client.link.replyError(id, 'workspace.busy', 'the main checkout is in use by another live session');
    }
    const busy = (branch: string) => branchIsBusy(ctx.db, project, branch, sessionId);
    if (workspace.kind === 'checkout' && busy(workspace.branch)) {
      releaseSessionPorts(ctx.db, sessionId);
      return client.link.replyError(id, 'workspace.busy', `${workspace.branch} is in use by another live session`);
    }
    const setupEnv = sessionEnvironment({ session: sessionId, project, cwd: project, base: ports.base });
    let result;
    try { result = await resolveWorkspace(project, workspace, body.workspaceName as string | undefined, sessionId, busy, setupEnv); }
    catch (error) { releaseSessionPorts(ctx.db, sessionId); throw error; }
    if ('err' in result) {
      releaseSessionPorts(ctx.db, sessionId);
      return client.link.replyError(id, result.err, result.detail ?? result.err);
    }
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
  try {
    validatePrompt(cwd, {
      text: '',
      context: body.context as PromptContext[] | undefined,
      attachments: body.attachments as PromptAttachment[] | undefined,
    });
  } catch (error) {
    releaseSessionPorts(ctx.db, sessionId);
    return client.link.replyError(id, 'prompt.invalid', error instanceof Error ? error.message : String(error));
  }
  const machine = String(body.machine ?? 'm_local');
  const lease = sharedScratch ? {} : acquireWorkspace(ctx.db, cwd, sessionId, machine);
  if (lease.conflict) {
    releaseSessionPorts(ctx.db, sessionId);
    return client.link.replyError(id, 'lease.conflict', `workspace held by ${lease.conflict}`);
  }
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
  if (body.team) setSessionTeam(ctx.db, sessionId, String(body.team));
  if (Array.isArray(body.context) || Array.isArray(body.attachments)) {
    setPendingPromptData(ctx.db, sessionId, {
      ...(Array.isArray(body.context) ? { context: body.context as never[] } : {}),
      ...(Array.isArray(body.attachments) ? { attachments: body.attachments as never[] } : {}),
    });
  }
  for (const step of resolved.steps ?? []) ctx.record(sessionId, 'workspace_step', { ...step });
  ctx.spawnWorker(sessionId);
  client.link.reply(id, { session: sessionId });
}
