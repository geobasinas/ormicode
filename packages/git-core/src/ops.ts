import { CommandError, currentBranch, git, resolveCommit, run } from './commands.ts';

export class NothingToCommit extends Error {
  constructor() { super('nothing staged to commit'); this.name = 'NothingToCommit'; }
}

function clean(cwd: string): boolean { return git(cwd, 'status', '--porcelain=v2', '-z').length === 0; }
function conflicts(cwd: string): string[] {
  try { return git(cwd, 'diff', '--name-only', '--diff-filter=U', '-z').split('\0').filter(Boolean); }
  catch { return []; }
}
function head(cwd: string) { return git(cwd, 'rev-parse', 'HEAD').trim(); }

export function stage(cwd: string, paths?: string[]) {
  git(cwd, 'add', '-A', ...(paths?.length ? ['--', ...paths] : []));
}

export function unstage(cwd: string, paths?: string[]) {
  git(cwd, 'reset', '-q', ...(paths?.length ? ['--', ...paths] : []));
}

export function commit(cwd: string, message: string, amend = false) {
  if (!amend && git(cwd, 'diff', '--cached', '--name-only', '-z').length === 0) throw new NothingToCommit();
  try { run('git', cwd, ['commit', ...(amend ? ['--amend'] : []), '-F', '-'], message); }
  catch (error) {
    if (error instanceof CommandError && /identity unknown|unable to auto-detect email|empty ident|no (?:email|name) was given/i.test(error.message))
      throw new Error('Git identity is missing. Set user.name/user.email for this repository: git config user.name "Your Name" and git config user.email "you@example.com".', { cause: error });
    throw error;
  }
  return { sha: head(cwd) };
}

export function push(cwd: string) {
  const branch = currentBranch(cwd);
  if (!branch) throw new Error('cannot push a detached HEAD');
  git(cwd, 'push', '-u', 'origin', branch);
  const upstream = git(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim();
  return { branch, upstream };
}

function dirtyGuard(cwd: string, continuation: boolean, abort: boolean) {
  if (!continuation && !abort && !clean(cwd)) throw new Error('worktree has uncommitted changes');
}

function result(cwd: string, operation: () => void) {
  try {
    operation();
    return { state: 'done' as const, head: head(cwd) };
  } catch (error) {
    const files = conflicts(cwd);
    if (files.length && error instanceof CommandError) return { state: 'conflict' as const, conflict: { files } };
    throw error;
  }
}

export function merge(cwd: string, branch: string, continuation = false, abort = false) {
  dirtyGuard(cwd, continuation, abort);
  return result(cwd, () => {
    if (abort) git(cwd, 'merge', '--abort');
    else if (continuation) git(cwd, '-c', 'core.editor=true', 'merge', '--continue');
    else git(cwd, 'merge', '--no-edit', resolveCommit(cwd, branch));
  });
}

function commitList(cwd: string, commits: string[]): string[] {
  return commits.map(value => {
    const sha = resolveCommit(cwd, value);
    const parents = git(cwd, 'show', '-s', '--format=%P', sha).trim().split(/\s+/).filter(Boolean);
    if (parents.length > 1) throw new Error(`merge commit ${sha} cannot be picked or reverted`);
    return sha;
  });
}

function sequence(cwd: string, op: 'cherry-pick' | 'revert', commits: string[] | undefined, continuation: boolean, abort: boolean) {
  dirtyGuard(cwd, continuation, abort);
  return result(cwd, () => {
    if (abort) git(cwd, op, '--abort');
    else if (continuation) git(cwd, '-c', 'core.editor=true', op, '--continue');
    else {
      if (!commits?.length) throw new Error('commits are required');
      git(cwd, op, '--no-edit', ...commitList(cwd, commits));
    }
  });
}

export const cherryPick = (cwd: string, commits: string[] | undefined, continuation = false, abort = false) =>
  sequence(cwd, 'cherry-pick', commits, continuation, abort);
export const revert = (cwd: string, commits: string[] | undefined, continuation = false, abort = false) =>
  sequence(cwd, 'revert', commits, continuation, abort);
