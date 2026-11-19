import { commandMessage, git, gitResult, maybeGit } from './worktree-process.ts';

export class BranchOperationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export async function pullBranch(cwd: string, branch: string): Promise<{ updated: boolean; from: string; to: string }> {
  const upstream = await maybeGit(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`);
  if (!upstream) throw new BranchOperationError('git.no_upstream', `Branch ${branch} has no upstream`);
  const from = await git(cwd, 'rev-parse', branch);
  const current = await maybeGit(cwd, 'branch', '--show-current');
  let result;
  const slash = upstream.indexOf('/');
  if (slash < 1) throw new BranchOperationError('git.no_upstream', `Branch ${branch} has no remote upstream`);
  const remote = upstream.slice(0, slash);
  if (current === branch) {
    const fetched = await gitResult(cwd, ['fetch', remote]);
    if (fetched.code !== 0) throw new BranchOperationError('git.failed', commandMessage(fetched));
    result = await gitResult(cwd, ['merge', '--ff-only', '@{u}']);
  } else {
    const remoteBranch = upstream.slice(slash + 1);
    result = await gitResult(cwd, ['fetch', remote, `${remoteBranch}:${branch}`]);
  }
  if (result.code !== 0) {
    const detail = commandMessage(result);
    if (/not possible to fast-forward|non-fast-forward|would clobber existing tag/i.test(detail))
      throw new BranchOperationError('git.not_fast_forward', detail);
    throw new BranchOperationError('git.failed', detail);
  }
  const to = await git(cwd, 'rev-parse', branch);
  return { updated: from !== to, from, to };
}

export async function renameBranch(cwd: string, from: string, to: string): Promise<void> {
  const valid = await gitResult(cwd, ['check-ref-format', '--branch', to]);
  if (valid.code !== 0) throw new BranchOperationError('git.invalid_branch', `Invalid branch name: ${to}`);
  const result = await gitResult(cwd, ['branch', '-m', '--', from, to]);
  if (result.code !== 0) throw new BranchOperationError('git.failed', commandMessage(result));
}

export async function removeBranch(cwd: string, name: string, force = false): Promise<void> {
  const result = await gitResult(cwd, ['branch', force ? '-D' : '-d', '--', name]);
  if (result.code !== 0) {
    const detail = commandMessage(result);
    if (!force && /not fully merged|not merged/i.test(detail))
      throw new BranchOperationError('git.unmerged', detail);
    throw new BranchOperationError('git.failed', detail);
  }
}
