import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseWorktrees, sanitize, type WorktreeEntry } from './worktree-common.ts';
import { isGitRepo } from './commands.ts';

export type WorkspaceChoice =
  | { kind: 'current' }
  | { kind: 'branch'; branch: string; from?: string }
  | { kind: 'checkout'; branch: string }
  | { kind: 'worktree'; branch: string; name?: string; includeDirty?: boolean; skipInclude?: boolean; skipSetup?: boolean }
  | { kind: 'existing'; path: string };
export type WorkspaceStepName = 'fetch' | 'create' | 'copy_dirty' | 'include' | 'setup';
export interface WorkspaceStep {
  step: WorkspaceStepName;
  status: 'ok' | 'warn' | 'skipped';
  detail?: string;
  output?: string;
}
export interface ResolvedWorkspace {
  cwd: string; worktree?: string; branch?: string; baseBranch?: string; baseCommit?: string;
  steps?: WorkspaceStep[];
}
export type WorkspaceErr = {
  err: 'workspace.not_repo' | 'workspace.detached' | 'workspace.busy' | 'workspace.dirty_conflict'
    | 'workspace.branch_exists' | 'workspace.failed' | 'workspace.setup_failed';
  detail?: string;
};
export type { WorktreeEntry } from './worktree-common.ts';

const gitSync = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

interface SyncHead { branch: string | null; commit: string }
function headSync(dir: string): SyncHead {
  const commit = gitSync(dir, 'rev-parse', 'HEAD');
  let branch: string | null = null;
  try { branch = gitSync(dir, 'symbolic-ref', '--quiet', '--short', 'HEAD') || null; }
  catch { /* detached HEAD */ }
  return { branch, commit };
}

function uniqueBranchSync(dir: string, base: string): string {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `ormi/${base}` : `ormi/${base}-${i}`;
    try { gitSync(dir, 'rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`); }
    catch { return candidate; }
  }
}

function uniqueWorktreeDirSync(project: string, slug: string): string {
  const root = join(project, '.ormi', 'worktrees');
  for (let i = 1; ; i++) {
    const dir = join(root, i === 1 ? slug : `${slug}-${i}`);
    if (!existsSync(dir)) return dir;
  }
}

function addWorktree(project: string, slug: string, commit: string, branch = uniqueBranchSync(project, slug)): { dir: string; branch: string } {
  mkdirSync(join(project, '.ormi', 'worktrees'), { recursive: true });
  const dir = uniqueWorktreeDirSync(project, slug);
  try {
    gitSync(project, 'worktree', 'add', dir, '-b', branch, commit);
  } catch (error) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { gitSync(project, 'worktree', 'prune'); } catch { /* best effort */ }
    try { gitSync(project, 'branch', '-D', branch); } catch { /* best effort */ }
    throw error;
  }
  return { dir, branch };
}

export function listWorktrees(project: string): WorktreeEntry[] {
  return parseWorktrees(gitSync(project, 'worktree', 'list', '--porcelain'));
}

export function defaultBranch(project: string): string | null {
  const symbolic = (() => {
    try { return gitSync(project, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'); }
    catch { return ''; }
  })();
  if (symbolic) return symbolic;
  for (const name of ['origin/main', 'origin/master']) {
    try { gitSync(project, 'rev-parse', '--verify', '--quiet', `refs/remotes/${name}`); return name; }
    catch { /* try next */ }
  }
  return null;
}

export function forkWorktree(project: string, fromCwd: string, branch: string): { dir: string; branch: string; commit: string } | WorkspaceErr {
  const projectPath = resolve(project);
  const fromPath = resolve(fromCwd);
  if (!isGitRepo(projectPath) || !isGitRepo(fromPath)) return { err: 'workspace.not_repo', detail: `${project} is not a git repository` };
  try {
    gitSync(projectPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    return { err: 'workspace.failed', detail: `branch ${branch} already exists` };
  } catch { /* name is free */ }
  const commit = headSync(fromPath).commit;
  try { return { ...addWorktree(projectPath, sanitize(branch).replace(/\//g, '-'), commit, branch), commit }; }
  catch (error) { return { err: 'workspace.failed', detail: String(error) }; }
}

export function removeWorktree(project: string, dir: string, branch: string): void {
  try { gitSync(project, 'worktree', 'remove', '--force', dir); } catch { /* best effort */ }
  try { rmSync(dir, { recursive: true, force: true }); gitSync(project, 'worktree', 'prune'); } catch { /* best effort */ }
  try { gitSync(project, 'branch', '-D', branch); } catch { /* best effort */ }
}

export { fetchProject, resolveWorkspace } from './worktree-resolve.ts';
