import { currentBranch, git, resolveCommit } from './commands.ts';

function refs(cwd: string, pattern: string): string[][] {
  const format = '%(refname:short)%00%(objectname)%00%(subject)%00%(committerdate:unix)%00%(upstream:short)%00%(upstream:track,nobracket)%00';
  return git(cwd, 'for-each-ref', `--format=${format}`, pattern).split('\n').filter(Boolean)
    .map(line => line.split('\0'));
}

export function branches(cwd: string) {
  const current = currentBranch(cwd);
  const local = refs(cwd, 'refs/heads').map(([name = '', sha = '', subject = '', ts = '0', upstreamValue = '', track = '']) => {
    const gone = track.trim() === 'gone';
    const ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
    const behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
    return {
      name, sha, subject, ts: Number(ts) * 1000, upstream: upstreamValue || null,
      ahead, behind, current: name === current, gone,
    };
  });
  const remote = refs(cwd, 'refs/remotes').filter(([name]) => !name?.endsWith('/HEAD'))
    .map(([name = '', sha = '', subject = '', ts = '0']) => ({ name, sha, subject, ts: Number(ts) * 1000 }));
  return { current, local, remote };
}

export function checkout(cwd: string, branch: string) {
  if (git(cwd, 'status', '--porcelain=v2', '-z').length) throw new Error('worktree has uncommitted changes');
  git(cwd, 'switch', '--quiet', '--', branch);
  return { branch: currentBranch(cwd) ?? branch };
}

export function createBranch(cwd: string, name: string, from?: string, shouldCheckout = true) {
  git(cwd, 'check-ref-format', '--branch', name);
  const args = shouldCheckout ? ['switch', '--quiet', '-c', name] : ['branch', name];
  if (from) args.push(resolveCommit(cwd, from));
  git(cwd, ...args);
  return { branch: name };
}

export function deleteBranch(cwd: string, name: string) {
  git(cwd, 'check-ref-format', '--branch', name);
  if (currentBranch(cwd) === name) throw new Error('cannot delete the current branch');
  git(cwd, 'branch', '-D', '--', name);
}
