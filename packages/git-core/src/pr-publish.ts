import { currentBranch, git } from './commands.ts';
import { createPr } from './pull-request.ts';

export interface PreparedPr { cwd: string; branch: string; head: string; base: string; remote: string }

export function preparePr(cwd: string, base: string | null): PreparedPr {
  const branch = currentBranch(cwd);
  if (!branch) throw new Error('cannot create a PR from detached HEAD');
  if (!base) throw new Error('session has no recorded base branch; supply base');
  base = base.replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  git(cwd, 'check-ref-format', '--branch', base);
  if (branch === base) throw new Error('PR head and base must be different branches');
  if (git(cwd, 'status', '--porcelain', '--', '.', ':(exclude).ormi/worktrees').trim()) throw new Error('worktree has uncommitted changes; commit them first');
  const head = git(cwd, 'rev-parse', '--verify', 'HEAD').trim();
  const remote = git(cwd, 'remote', 'get-url', '--push', 'origin').trim();
  if (/^https?:\/\/[^/]*@/i.test(remote)) throw new Error('use a credential helper, not credentials embedded in the remote URL');
  if (!remote || /[\r\n]/.test(remote)) throw new Error('origin must have one push URL');
  if (git(cwd, 'remote', 'get-url', '--push', '--all', 'origin').trim() !== remote) throw new Error('origin must have one push URL');
  return { cwd, branch, head, base, remote };
}

function repository(remote: string): string {
  const ssh = /^(?:[^/@]+@)?([^/:]+):(.+)$/.exec(remote);
  if (ssh && !/^[a-zA-Z]:[\\/]/.test(remote) && !remote.includes('://')) return `${ssh[1]}/${ssh[2]}`.replace(/\.git$/, '');
  try { const url = new URL(remote); return `${url.host}${url.pathname}`.replace(/\.git$/, ''); }
  catch { return remote; }
}

export function publishPr(approved: PreparedPr, title: string, body: string, draft = false) {
  const current = preparePr(approved.cwd, approved.base);
  if (current.branch !== approved.branch || current.head !== approved.head || current.remote !== approved.remote)
    throw new Error('repository changed; request a new approval');
  git(approved.cwd, 'push', '--', approved.remote, `${approved.head}:refs/heads/${approved.branch}`);
  return createPr(approved.cwd, approved.base, title, body, draft, { branch: approved.branch, repo: repository(approved.remote) });
}
