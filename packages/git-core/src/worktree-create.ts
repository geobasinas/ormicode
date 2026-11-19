import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { worktreeSlug } from './worktree-common.ts';
import { copyDirty, includeIgnored } from './worktree-copy.ts';
import { commandMessage, git, gitResult, maybeGit, run } from './worktree-process.ts';
import type { ResolvedWorkspace, WorkspaceErr, WorkspaceStep } from './worktree.ts';

export async function uniqueBranch(dir: string, base: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `ormi/${base}` : `ormi/${base}-${i}`;
    if (await maybeGit(dir, 'rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`) === undefined) return candidate;
  }
}

async function uniqueWorktreeDir(project: string, slug: string): Promise<string> {
  const root = join(project, '.ormi', 'worktrees');
  await mkdir(root, { recursive: true });
  for (let i = 1; ; i++) {
    const dir = join(root, i === 1 ? slug : `${slug}-${i}`);
    try { await access(dir); } catch { return dir; }
  }
}

async function cleanupWorktree(project: string, dir: string, branch: string, deleteBranch: boolean): Promise<void> {
  try { await git(project, 'worktree', 'remove', '--force', dir); } catch { /* best effort */ }
  try { await rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  try { await git(project, 'worktree', 'prune'); } catch { /* best effort */ }
  if (deleteBranch) try { await git(project, 'branch', '-D', branch); } catch { /* best effort */ }
}

function remoteName(ref: string, remotes: string[]): string | undefined {
  const slash = ref.indexOf('/');
  if (slash < 1) return undefined;
  const name = ref.slice(0, slash);
  return remotes.includes(name) ? name : undefined;
}

export async function createWorkspaceWorktree(
  project: string, baseRef: string, slugInput: string, explicitName: string | undefined,
  includeDirty: boolean, mainBranch: string | null, skipInclude = false, skipSetup = false,
): Promise<ResolvedWorkspace | WorkspaceErr> {
  const steps: WorkspaceStep[] = [];
  const remotes = (await maybeGit(project, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
  const remote = remoteName(baseRef, remotes);
  let fetchStep: WorkspaceStep;
  if (remote) {
    const fetched = await gitResult(project, ['fetch', '--prune', remote], undefined, 30_000, 8192);
    if (fetched.code === 0) fetchStep = { step: 'fetch', status: 'ok', detail: `fetched ${remote}` };
    else {
      const detail = commandMessage(fetched, 30_000).replace(/https?:\/\/[^/@\s]+@/g, 'https://[redacted]@');
      fetchStep = { step: 'fetch', status: 'warn', detail: `fetch failed; using cached ref: ${detail}` };
    }
  } else fetchStep = { step: 'fetch', status: 'skipped', detail: 'base is not a remote ref' };
  steps.push(fetchStep);

  let resolvedRef: string;
  if (remote) resolvedRef = `refs/remotes/${baseRef}`;
  else if (await maybeGit(project, 'rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${baseRef}^{commit}`) !== undefined)
    resolvedRef = `refs/heads/${baseRef}`;
  else resolvedRef = baseRef;
  const commit = await maybeGit(project, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${resolvedRef}^{commit}`);
  if (!commit) return { err: 'workspace.failed', detail: `create: base ref ${baseRef} not found` };
  if (includeDirty && (!mainBranch || baseRef !== mainBranch))
    return { err: 'workspace.failed', detail: 'copy_dirty: uncommitted changes can only be included from the current branch' };

  const slug = worktreeSlug(explicitName ?? slugInput);
  const branch = explicitName ?? await uniqueBranch(project, worktreeSlug(slugInput));
  const valid = await run('git', ['check-ref-format', '--branch', branch], { cwd: project });
  if (valid.code !== 0) return { err: 'workspace.failed', detail: `create: invalid branch name ${branch}` };
  const branchExists = await maybeGit(project, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`) !== undefined;
  if (branchExists) return { err: 'workspace.failed', detail: `create: branch ${branch} already exists` };

  let dir: string | undefined;
  try {
    dir = await uniqueWorktreeDir(project, slug);
    const added = await gitResult(project, ['worktree', 'add', '-b', branch, dir, resolvedRef]);
    if (added.code !== 0) throw new Error(commandMessage(added));
    steps.push({ step: 'create', status: 'ok', detail: `created ${branch} from ${baseRef}` });
  } catch (error) {
    if (dir) await cleanupWorktree(project, dir, branch, !branchExists);
    return { err: 'workspace.failed', detail: `create: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (includeDirty) {
    try {
      const untracked = await copyDirty(project, dir);
      steps.push({ step: 'copy_dirty', status: 'ok', detail: `copied tracked changes and ${untracked} untracked file${untracked === 1 ? '' : 's'}` });
    } catch (error) {
      await cleanupWorktree(project, dir, branch, true);
      return { err: 'workspace.failed', detail: `copy_dirty: ${error instanceof Error ? error.message : String(error)}` };
    }
  } else steps.push({ step: 'copy_dirty', status: 'skipped', detail: 'uncommitted changes were not requested' });

  if (skipInclude) steps.push({ step: 'include', status: 'skipped', detail: 'copying ignored files was disabled' });
  else {
    try { steps.push(await includeIgnored(project, dir)); }
    catch (error) {
      await cleanupWorktree(project, dir, branch, true);
      return { err: 'workspace.failed', detail: `include: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const setup = join(project, '.ormi', 'setup');
  if (skipSetup) {
    steps.push({ step: 'setup', status: 'skipped', detail: 'setup script was disabled' });
    return { cwd: dir, worktree: dir, branch, baseBranch: baseRef, baseCommit: commit, steps };
  }
  try {
    await access(setup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      steps.push({ step: 'setup', status: 'skipped', detail: '.ormi/setup not found' });
      return { cwd: dir, worktree: dir, branch, baseBranch: baseRef, baseCommit: commit, steps };
    }
    await cleanupWorktree(project, dir, branch, true);
    return { err: 'workspace.failed', detail: `setup: ${error instanceof Error ? error.message : String(error)}` };
  }

  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(setup);
  const setupResult = await run(batch ? 'cmd' : 'bash', batch ? ['/c', setup] : [setup], {
    cwd: dir, env: { ORMI_ROOT_PATH: project, ORMI_WORKTREE_PATH: dir }, timeoutMs: 10 * 60_000, tailBytes: 8192,
  });
  const output = setupResult.output.toString('utf8');
  if (setupResult.code !== 0) {
    await cleanupWorktree(project, dir, branch, true);
    const reason = setupResult.timedOut ? 'timed out after 600 seconds'
      : setupResult.error?.message ?? `exited with code ${setupResult.code ?? 'unknown'}`;
    return { err: 'workspace.setup_failed', detail: `setup: ${reason}${output ? `\n${output}` : ''}` };
  }
  steps.push({ step: 'setup', status: 'ok', detail: 'setup script completed', ...(output ? { output } : {}) });
  return { cwd: dir, worktree: dir, branch, baseBranch: baseRef, baseCommit: commit, steps };
}
