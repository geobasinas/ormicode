import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { getSession, listSessions, setBranch } from '@ormicode/session-store';
import { busyBranches } from './branch-busy.ts';
import {
  branches, checkout, createBranch, createPr, deleteBranch, isGitRepo, log, merge, mergePr,
  NothingToCommit, commit, prStatus, push, revert, show, stage, stash, status, unstage, cherryPick,
  defaultBranch, fetchProject, listWorktrees,
} from '@ormicode/git-core';
import type { Client, DispatchCtx } from './dispatch.ts';

const IN_TURN = new Set(['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying']);
const MUTATING = new Set([
  'git.stage', 'git.unstage', 'git.commit', 'git.push', 'git.checkout', 'git.createBranch',
  'git.deleteBranch', 'git.merge', 'git.cherryPick', 'git.revert', 'git.pr', 'git.prMerge',
]);

function mutates(method: string, body: Record<string, unknown>) {
  return MUTATING.has(method) || (method === 'git.stash' && ['push', 'pop', 'apply', 'drop'].includes(String(body.op)));
}

function conflictResult(result: { state: 'done' | 'conflict'; head?: string; conflict?: { files: string[] } }) {
  return result.state === 'done' ? { state: 'done', head: result.head! } : { state: 'conflict', conflict: result.conflict! };
}

export async function gitMethod(
  ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>,
): Promise<void> {
  const sessionId = String(body.session);
  const row = getSession(ctx.db, sessionId);
  if (!row) return client.link.replyError(id, 'session.not_found', sessionId);
  if (mutates(method, body) && IN_TURN.has(row.state))
    return client.link.replyError(id, 'checkpoint.busy', 'a turn is running; stop it first');
  if (!isGitRepo(row.cwd)) return client.link.replyError(id, 'git.failed', 'session cwd is not a git repository');
  const cwd = row.cwd;
  try {
    switch (method) {
      case 'git.status': return client.link.reply(id, { ...status(cwd, row.base_branch) });
      case 'git.stage': stage(cwd, body.paths as string[] | undefined); return client.link.reply(id, {});
      case 'git.unstage': unstage(cwd, body.paths as string[] | undefined); return client.link.reply(id, {});
      case 'git.commit': return client.link.reply(id, { ...commit(cwd, String(body.message), Boolean(body.amend)) });
      case 'git.push': return client.link.reply(id, push(cwd));
      case 'git.log': return client.link.reply(id, log(cwd, {
        ref: body.ref as string | undefined, limit: body.limit as number | undefined, skip: body.skip as number | undefined,
      }));
      case 'git.show': return client.link.reply(id, show(cwd, String(body.sha)));
      case 'git.branches': return client.link.reply(id, branches(cwd));
      case 'git.checkout': {
        if (status(cwd, row.base_branch).files.length) return client.link.replyError(id, 'git.dirty_worktree', 'worktree has uncommitted changes');
        const result = checkout(cwd, String(body.branch));
        setBranch(ctx.db, row.id, result.branch);
        return client.link.reply(id, result);
      }
      case 'git.createBranch': {
        const result = createBranch(cwd, String(body.name), body.from as string | undefined, body.checkout !== false);
        if (body.checkout !== false) setBranch(ctx.db, row.id, result.branch);
        return client.link.reply(id, result);
      }
      case 'git.deleteBranch':
        if (body.confirm !== body.name) return client.link.replyError(id, 'git.confirm_required', 'confirm must equal the branch name');
        deleteBranch(cwd, String(body.name));
        return client.link.reply(id, {});
      case 'git.merge':
        if (!body.branch && !row.base_branch && !body.continue && !body.abort)
          return client.link.replyError(id, 'git.failed', 'session has no recorded base branch');
        return client.link.reply(id, conflictResult(merge(cwd, String(body.branch ?? row.base_branch ?? ''), Boolean(body.continue), Boolean(body.abort))));
      case 'git.cherryPick':
        return client.link.reply(id, conflictResult(cherryPick(cwd, body.commits as string[] | undefined, Boolean(body.continue), Boolean(body.abort))));
      case 'git.revert':
        return client.link.reply(id, conflictResult(revert(cwd, body.commits as string[] | undefined, Boolean(body.continue), Boolean(body.abort))));
      case 'git.stash': {
        const result = stash(cwd, {
          op: body.op as 'list' | 'show' | 'push' | 'pop' | 'apply' | 'drop',
          index: body.index as number | undefined, message: body.message as string | undefined,
          includeUntracked: Boolean(body.includeUntracked),
        });
        return client.link.reply(id, result);
      }
      case 'git.prStatus': return client.link.reply(id, prStatus(cwd));
      case 'git.pr':
        return client.link.reply(id, createPr(cwd, row.base_branch, String(body.title), String(body.body), Boolean(body.draft)));
      case 'git.prMerge':
        mergePr(cwd, body.method as 'squash' | 'merge' | 'rebase');
        return client.link.reply(id, {});
      default: return client.link.replyError(id, 'protocol.unimplemented', method);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof NothingToCommit ? 'git.nothing_to_commit'
      : /worktree has uncommitted changes/.test(message) ? 'git.dirty_worktree' : 'git.failed';
    return client.link.replyError(id, code, message);
  }
}

/** Branch catalog for a project dir before a session exists — feeds the
 * composer's workspace picker. Non-repos and 'scratch' reply isRepo:false. */
export function projectBranches(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>): void {
  const project = String(body.project);
  if (project === 'scratch' || !isGitRepo(project)) {
    return client.link.reply(id, {
      isRepo: false, current: null, local: [], remote: [], detached: false, dirty: 0, busyBranches: [],
      defaultBranch: null, worktrees: [], hasWorktreeInclude: false, hasSetup: false, fetchedAt: null,
    });
  }
  const info = branches(project);
  const remote = info.remote.filter(branch => branch.name.includes('/') && !branch.name.endsWith('/HEAD'));
  const local = info.local
    .sort((a, b) => Number(b.current) - Number(a.current) || b.ts - a.ts || a.name.localeCompare(b.name));
  const canonical = (path: string) => {
    const normalized = resolve(path);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const fetchedAt = (() => {
    try {
      const gitPath = execFileSync('git', ['-C', project, 'rev-parse', '--git-path', 'FETCH_HEAD'], { encoding: 'utf8' }).trim();
      return Math.floor(statSync(isAbsolute(gitPath) ? gitPath : resolve(project, gitPath)).mtimeMs);
    } catch { return null; }
  })();
  const isFile = (path: string) => {
    try { return statSync(path).isFile(); } catch { return false; }
  };
  const sessions = listSessions(ctx.db);
  const worktreeRows = listWorktrees(project)
    .filter(worktree => canonical(worktree.path) !== canonical(project))
    .map(worktree => {
      const session = sessions.find(row =>
        (row.worktree && canonical(row.worktree) === canonical(worktree.path))
        || canonical(row.cwd) === canonical(worktree.path));
      let dirty = 0;
      try { dirty = status(worktree.path, null).files.length; } catch { /* unavailable worktree */ }
      return { path: worktree.path, branch: worktree.branch, session: session?.id ?? null, state: session?.state ?? null, dirty };
    });
  return client.link.reply(id, {
    isRepo: true, ...info, local, remote, detached: info.current === null,
    dirty: status(project, null).files.length, busyBranches: busyBranches(ctx.db, project),
    defaultBranch: defaultBranch(project), worktrees: worktreeRows,
    hasWorktreeInclude: isFile(resolve(project, '.worktreeinclude')),
    hasSetup: isFile(resolve(project, '.ormi', 'setup')),
    fetchedAt,
  });
}

export async function projectFetch(_ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>): Promise<void> {
  return client.link.reply(id, await fetchProject(String(body.project)));
}
