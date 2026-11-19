import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fixture, git } from './helpers.mjs';
import { branches } from '../src/branches.ts';
import { pullBranch, removeBranch, renameBranch } from '../src/branch-operations.ts';

function advanceRemote(repo, branch, file = `${branch.replaceAll('/', '-')}.txt`) {
  const clone = `${repo.root}/remote-${branch.replaceAll('/', '-')}`;
  execFileSync('git', ['clone', '-q', repo.origin, clone]);
  git(clone, 'config', 'user.name', 'Git Test');
  git(clone, 'config', 'user.email', 'git-test@example.com');
  if (branch !== 'main') git(clone, 'switch', '-c', branch, '--track', `origin/${branch}`);
  writeFileSync(`${clone}/${file}`, `from ${branch}\n`);
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', `advance ${branch}`);
  git(clone, 'push', '-u', 'origin', branch);
  return git(clone, 'rev-parse', 'HEAD');
}

test('project branches include merge and linked-worktree metadata', () => {
  const repo = fixture();
  try {
    git(repo.cwd, 'branch', 'merged');
    git(repo.cwd, 'switch', '-c', 'unmerged');
    writeFileSync(`${repo.cwd}/unmerged.txt`, 'unmerged\n');
    git(repo.cwd, 'add', '.'); git(repo.cwd, 'commit', '-m', 'unmerged');
    git(repo.cwd, 'switch', 'main');
    const worktree = `${repo.root}/linked`;
    git(repo.cwd, 'worktree', 'add', '-b', 'linked', worktree);
    const info = branches(repo.cwd, 'main');
    assert.equal(info.local.find(branch => branch.name === 'merged')?.merged, true);
    assert.equal(info.local.find(branch => branch.name === 'unmerged')?.merged, false);
    assert.equal(info.local.find(branch => branch.name === 'linked')?.worktreePath, worktree);
    assert.equal(info.local.find(branch => branch.name === 'main')?.worktreePath, null);
  } finally { repo.cleanup(); }
});

test('pullBranch fast-forwards the current and other local branches', async () => {
  const repo = fixture();
  try {
    const mainHead = advanceRemote(repo, 'main');
    const main = await pullBranch(repo.cwd, 'main');
    assert.equal(main.updated, true);
    assert.equal(main.to, mainHead);
    git(repo.cwd, 'switch', '-c', 'feature');
    git(repo.cwd, 'push', '-u', 'origin', 'feature');
    const featureHead = advanceRemote(repo, 'feature');
    git(repo.cwd, 'switch', 'main');
    const feature = await pullBranch(repo.cwd, 'feature');
    assert.equal(feature.updated, true);
    assert.equal(feature.to, featureHead);
  } finally { repo.cleanup(); }
});

test('pullBranch reports missing upstreams and non-fast-forward updates', async () => {
  const repo = fixture();
  try {
    git(repo.cwd, 'switch', '-c', 'untracked');
    await assert.rejects(pullBranch(repo.cwd, 'untracked'), error => error.code === 'git.no_upstream');
    git(repo.cwd, 'switch', 'main');
    git(repo.cwd, 'switch', '-c', 'diverged');
    git(repo.cwd, 'push', '-u', 'origin', 'diverged');
    const remote = `${repo.root}/diverged-remote`;
    execFileSync('git', ['clone', '-q', repo.origin, remote]);
    git(remote, 'config', 'user.name', 'Git Test');
    git(remote, 'config', 'user.email', 'git-test@example.com');
    git(remote, 'switch', 'diverged');
    writeFileSync(`${remote}/remote.txt`, 'remote\n');
    git(remote, 'add', '.'); git(remote, 'commit', '-m', 'remote update'); git(remote, 'push');
    git(repo.cwd, 'switch', 'diverged');
    writeFileSync(`${repo.cwd}/local.txt`, 'local\n');
    git(repo.cwd, 'add', '.'); git(repo.cwd, 'commit', '-m', 'local update');
    git(repo.cwd, 'switch', 'main');
    await assert.rejects(pullBranch(repo.cwd, 'diverged'), error => error.code === 'git.not_fast_forward');
  } finally { repo.cleanup(); }
});

test('renameBranch validates names and removeBranch requires force for unmerged branches', async () => {
  const repo = fixture();
  try {
    git(repo.cwd, 'branch', 'feature');
    await renameBranch(repo.cwd, 'feature', 'renamed');
    assert.match(git(repo.cwd, 'branch', '--list'), /renamed/);
    await assert.rejects(renameBranch(repo.cwd, 'renamed', 'bad name'), error => error.code === 'git.invalid_branch');
    git(repo.cwd, 'switch', '-c', 'unmerged');
    writeFileSync(`${repo.cwd}/new.txt`, 'new\n');
    git(repo.cwd, 'add', '.'); git(repo.cwd, 'commit', '-m', 'unmerged');
    git(repo.cwd, 'switch', 'main');
    await assert.rejects(removeBranch(repo.cwd, 'unmerged'), error => error.code === 'git.unmerged');
    await removeBranch(repo.cwd, 'unmerged', true);
    assert.equal(git(repo.cwd, 'branch', '--list', 'unmerged'), '');
  } finally { repo.cleanup(); }
});
