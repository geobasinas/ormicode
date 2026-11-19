import { branches, isGitRepo, pullBranch, removeBranch, renameBranch } from '@ormicode/git-core';
import { branchIsBusy, mainCheckoutIsBusy } from './branch-busy.ts';
import type { Client, DispatchCtx } from './dispatch.ts';

export async function projectBranchMethod(
  ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>,
): Promise<void> {
  const project = String(body.project);
  if (!isGitRepo(project)) return client.link.replyError(id, 'workspace.not_repo', `${project} is not a git repository`);
  const info = branches(project);
  const fail = (code: string, message: string) => client.link.replyError(id, code, message);
  try {
    if (method === 'project.pull') {
      const name = String(body.branch);
      const branch = info.local.find(item => item.name === name);
      if (!branch) return fail('git.branch_not_found', `Local branch ${name} was not found`);
      if (branchIsBusy(ctx.db, project, name) || branch.worktreePath || (branch.current && mainCheckoutIsBusy(ctx.db, project)))
        return fail('git.branch_in_use', `${name} is in use by a live session or worktree`);
      return client.link.reply(id, await pullBranch(project, name));
    }
    if (method === 'project.renameBranch') {
      const from = String(body.from);
      const branch = info.local.find(item => item.name === from);
      if (!branch) return fail('git.branch_not_found', `Local branch ${from} was not found`);
      if (branchIsBusy(ctx.db, project, from) || branch.worktreePath)
        return fail('git.branch_in_use', `${from} is in use by a live session or worktree`);
      await renameBranch(project, from, String(body.to));
      return client.link.reply(id, {});
    }
    const name = String(body.name);
    if (body.confirm !== name) return fail('git.confirm_required', 'confirm must equal the branch name');
    const branch = info.local.find(item => item.name === name);
    if (!branch) return fail('git.branch_not_found', `Local branch ${name} was not found`);
    if (branch.current) return fail('git.branch_in_use', `Cannot delete the current branch ${name}`);
    if (branchIsBusy(ctx.db, project, name) || branch.worktreePath)
      return fail('git.branch_in_use', `${name} is in use by a live session or worktree`);
    await removeBranch(project, name, Boolean(body.force));
    return client.link.reply(id, {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
      ? error.code : 'git.failed';
    return fail(code, message);
  }
}
