// Git workspace resolution for session.start. Implements the README rules:
// record the resolved branch + starting commit, detached HEAD requires an
// explicit workspace choice, a busy branch auto-reserves a worktree, worktrees
// live in <project>/.ormi/worktrees/<slug>, and a failed worktree add cleans up.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkspaceChoice { kind: 'current' | 'branch' | 'worktree'; branch?: string }
export interface ResolvedWorkspace {
  cwd: string; worktree?: string; branch?: string; baseBranch?: string; baseCommit?: string;
}
export type WorkspaceErr = { err: 'workspace.not_repo' | 'workspace.detached' | 'workspace.failed'; detail?: string };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function isRepo(dir: string): boolean {
  try { return git(dir, 'rev-parse', '--is-inside-work-tree') === 'true'; } catch { return false; }
}

interface Head { branch: string | null; commit: string }
function head(dir: string): Head {
  const commit = git(dir, 'rev-parse', 'HEAD');
  let branch: string | null = null;
  try { branch = git(dir, 'symbolic-ref', '--quiet', '--short', 'HEAD') || null; }
  catch { /* detached HEAD */ }
  return { branch, commit };
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '') || 'ws';
}

/** First free branch name: `ormi/<slug>`, `ormi/<slug>-2`, ... */
function uniqueBranch(dir: string, base: string): string {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `ormi/${base}` : `ormi/${base}-${i}`;
    try { git(dir, 'rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`); }
    catch { return candidate; }
  }
}

/** First free worktree dir under <project>/.ormi/worktrees/<slug>. */
function uniqueWorktreeDir(project: string, slug: string): string {
  const root = join(project, '.ormi', 'worktrees');
  for (let i = 1; ; i++) {
    const dir = join(root, i === 1 ? slug : `${slug}-${i}`);
    if (!existsSync(dir)) return dir;
  }
}

function addWorktree(project: string, slug: string, commit: string, branch = uniqueBranch(project, slug)): { dir: string; branch: string } {
  mkdirSync(join(project, '.ormi', 'worktrees'), { recursive: true });
  const dir = uniqueWorktreeDir(project, slug);
  try {
    git(project, 'worktree', 'add', dir, '-b', branch, commit);
  } catch (e) {
    // Failure cleanup: remove any partial dir and catalog entry, keep files untouched.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { git(project, 'worktree', 'prune'); } catch { /* best effort */ }
    try { git(project, 'branch', '-D', branch); } catch { /* best effort */ }
    throw e;
  }
  return { dir, branch };
}

export function resolveWorkspace(
  project: string, ws: WorkspaceChoice, workspaceName: string | undefined,
  sessionId: string, branchBusy: (branch: string) => boolean,
): ResolvedWorkspace | WorkspaceErr {
  if (!isRepo(project)) {
    if (ws.kind === 'current') return { cwd: project };
    return { err: 'workspace.not_repo', detail: `${project} is not a git repository` };
  }
  const { branch, commit } = head(project);
  const slug = sanitize(workspaceName ?? ws.branch ?? sessionId.slice(-8));
  if (ws.kind === 'current' && !branch) {
    return { err: 'workspace.detached', detail: 'HEAD is detached; choose branch or worktree' };
  }
  // An explicit worktree choice, or a busy checked-out branch, gets a fresh
  // worktree at the recorded commit. Uncommitted changes never move.
  if (ws.kind === 'worktree' || (ws.kind === 'current' && branch && branchBusy(branch))) {
    let base = commit; let baseBranch = branch;
    if (ws.kind === 'worktree' && ws.branch) {
      baseBranch = ws.branch;
      try { base = git(project, 'rev-parse', ws.branch); }
      catch { return { err: 'workspace.failed', detail: `unknown branch ${ws.branch}` }; }
    }
    try {
      const wt = addWorktree(project, slug, base);
      return { cwd: wt.dir, worktree: wt.dir, branch: wt.branch, baseBranch: baseBranch ?? undefined, baseCommit: base };
    } catch (e) {
      return { err: 'workspace.failed', detail: String(e) };
    }
  }
  if (ws.kind === 'branch') {
    const name = ws.branch ?? uniqueBranch(project, slug);
    try {
      git(project, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`);
      return { err: 'workspace.failed', detail: `branch ${name} already exists` };
    } catch { /* name is free */ }
    try { git(project, 'switch', '-c', name, commit); }
    catch (e) { return { err: 'workspace.failed', detail: String(e) }; }
    return { cwd: project, branch: name, baseBranch: branch ?? undefined, baseCommit: commit };
  }
  return { cwd: project, branch: branch ?? undefined, baseBranch: branch ?? undefined, baseCommit: commit };
}

/** New worktree on a new `branch` from `fromCwd`'s HEAD (checkpoint.fork). */
export function forkWorktree(project: string, fromCwd: string, branch: string): { dir: string; branch: string; commit: string } | WorkspaceErr {
  if (!isRepo(project) || !isRepo(fromCwd)) return { err: 'workspace.not_repo', detail: `${project} is not a git repository` };
  try {
    git(project, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    return { err: 'workspace.failed', detail: `branch ${branch} already exists` };
  } catch { /* name is free */ }
  const commit = git(fromCwd, 'rev-parse', 'HEAD');
  try { return { ...addWorktree(project, sanitize(branch).replace(/\//g, '-'), commit, branch), commit }; }
  catch (e) { return { err: 'workspace.failed', detail: String(e) }; }
}

export function removeWorktree(project: string, dir: string, branch: string): void {
  try { git(project, 'worktree', 'remove', '--force', dir); } catch { /* best effort */ }
  try { rmSync(dir, { recursive: true, force: true }); git(project, 'worktree', 'prune'); } catch { /* best effort */ }
  try { git(project, 'branch', '-D', branch); } catch { /* best effort */ }
}
