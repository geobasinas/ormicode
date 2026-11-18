import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWorktrees, sanitize, type WorktreeEntry } from './worktree-common.ts';
import { createWorkspaceWorktree, uniqueBranch } from './worktree-create.ts';
import { commandMessage, git, gitResult, headAsync, isRepoAsync, maybeGit, run } from './worktree-process.ts';
import type { ResolvedWorkspace, WorkspaceChoice, WorkspaceErr } from './worktree.ts';

function canonical(dir: string): string {
  const normalized = resolve(dir);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function listWorktreesAsync(project: string): Promise<WorktreeEntry[]> {
  return parseWorktrees(await git(project, 'worktree', 'list', '--porcelain'));
}

export async function fetchProject(project: string): Promise<{ ok: boolean; error?: string }> {
  if (!await isRepoAsync(project)) return { ok: false, error: `${project} is not a git repository` };
  const result = await gitResult(project, ['fetch', '--prune', '--all'], undefined, 30_000, 8192);
  if (result.code === 0) return { ok: true };
  const error = commandMessage(result, 30_000).replace(/https?:\/\/[^/@\s]+@/g, 'https://[redacted]@');
  return { ok: false, error };
}

export async function resolveWorkspace(
  project: string, ws: WorkspaceChoice, workspaceName: string | undefined,
  sessionId: string, branchBusy: (branch: string) => boolean,
): Promise<ResolvedWorkspace | WorkspaceErr> {
  if (!await isRepoAsync(project)) {
    if (ws.kind === 'current') return { cwd: project };
    return { err: 'workspace.not_repo', detail: `${project} is not a git repository` };
  }
  const { branch, commit } = await headAsync(project);
  if (ws.kind === 'existing') {
    let selectedPath: string;
    try { selectedPath = await realpath(ws.path); }
    catch { return { err: 'workspace.failed', detail: `existing: worktree path does not exist: ${ws.path}` }; }
    let mainPath: string;
    try { mainPath = await realpath(project); } catch { mainPath = resolve(project); }
    const entry = (await listWorktreesAsync(project)).find(worktree => canonical(worktree.path) === canonical(selectedPath));
    if (!entry) return { err: 'workspace.failed', detail: `existing: ${ws.path} is not a worktree of this project` };
    if (canonical(entry.path) === canonical(mainPath))
      return { err: 'workspace.failed', detail: 'existing: the main checkout is not an existing worktree choice' };
    const existingHead = await headAsync(selectedPath);
    return { cwd: selectedPath, worktree: selectedPath, branch: entry.branch ?? existingHead.branch ?? undefined, baseCommit: existingHead.commit };
  }
  const slug = sanitize(workspaceName ?? (ws.kind === 'worktree' ? ws.branch : undefined) ?? sessionId.slice(-8));
  if (ws.kind === 'current' && !branch)
    return { err: 'workspace.detached', detail: 'HEAD is detached; choose a branch or worktree' };

  if (ws.kind === 'worktree') {
    if (!branch && ws.includeDirty)
      return { err: 'workspace.failed', detail: 'copy_dirty: uncommitted changes can only be included from the current branch' };
    return createWorkspaceWorktree(
      project, ws.branch, workspaceName ?? ws.name ?? ws.branch ?? sessionId.slice(-8),
      ws.name, Boolean(ws.includeDirty), branch,
    );
  }

  if (ws.kind === 'current' && branch && branchBusy(branch))
    return createWorkspaceWorktree(project, branch, workspaceName ?? sessionId.slice(-8), undefined, false, branch);

  if (ws.kind === 'branch') {
    const name = ws.branch || await uniqueBranch(project, slug);
    const exists = await maybeGit(project, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`);
    if (exists !== undefined) return { err: 'workspace.failed', detail: `create: branch ${name} already exists` };
    const valid = await run('git', ['check-ref-format', '--branch', name], { cwd: project });
    if (valid.code !== 0) return { err: 'workspace.failed', detail: `create: invalid branch name ${name}` };
    const switched = await gitResult(project, ['switch', '-c', name, commit]);
    if (switched.code !== 0) return { err: 'workspace.failed', detail: `create: ${commandMessage(switched)}` };
    return { cwd: project, branch: name, baseBranch: branch ?? undefined, baseCommit: commit };
  }
  return { cwd: project, branch: branch ?? undefined, baseBranch: branch ?? undefined, baseCommit: commit };
}
