import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, git } from './helpers.mjs';
import { resolveWorkspace } from '../src/worktree.ts';

const resolve = (repo, workspace) => resolveWorkspace(repo.cwd, workspace, undefined, 's_testworktree', () => false);

test('remote worktree fetches the latest origin base before creating its branch', async () => {
  const repo = fixture();
  const update = join(repo.root, 'update');
  try {
    execFileSync('git', ['clone', '-q', repo.origin, update]);
    git(update, 'config', 'user.name', 'Git Test');
    git(update, 'config', 'user.email', 'git-test@example.com');
    writeFileSync(join(update, 'remote.txt'), 'advanced\n');
    git(update, 'add', '.');
    git(update, 'commit', '-m', 'advance remote');
    git(update, 'push', 'origin', 'main');
    const remoteHead = git(update, 'rev-parse', 'HEAD');

    const result = await resolve(repo, { kind: 'worktree', branch: 'origin/main', name: 'ormi/remote-update' });
    assert.ok(!('err' in result), JSON.stringify(result));
    assert.equal(git(result.cwd, 'rev-parse', 'HEAD'), remoteHead);
    assert.equal(result.baseBranch, 'origin/main');
    assert.equal(result.steps?.[0]?.step, 'fetch');
    assert.equal(result.steps?.[0]?.status, 'ok');
  } finally { repo.cleanup(); }
});

test('includeDirty copies tracked and untracked changes without moving them from the main checkout', async () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo.cwd, 'tracked.txt'), 'staged version\n');
    git(repo.cwd, 'add', 'tracked.txt');
    writeFileSync(join(repo.cwd, 'tracked.txt'), 'final unstaged version\n');
    writeFileSync(join(repo.cwd, 'untracked.txt'), 'untracked stays\n');

    const result = await resolve(repo, {
      kind: 'worktree', branch: 'main', name: 'ormi/dirty-copy', includeDirty: true,
    });
    assert.ok(!('err' in result), JSON.stringify(result));
    assert.equal(readFileSync(join(result.cwd, 'tracked.txt'), 'utf8'), 'final unstaged version\n');
    assert.equal(readFileSync(join(result.cwd, 'untracked.txt'), 'utf8'), 'untracked stays\n');
    assert.equal(readFileSync(join(repo.cwd, 'tracked.txt'), 'utf8'), 'final unstaged version\n');
    assert.equal(readFileSync(join(repo.cwd, 'untracked.txt'), 'utf8'), 'untracked stays\n');
    assert.equal(result.steps?.find(step => step.step === 'copy_dirty')?.status, 'ok');
  } finally { repo.cleanup(); }
});

test('.worktreeinclude copies only matching ignored files and reports files over 50 MB', async () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo.cwd, '.gitignore'), '.env\nprivate.txt\nlarge.bin\n');
    writeFileSync(join(repo.cwd, '.worktreeinclude'), '.env\nlarge.bin\n');
    writeFileSync(join(repo.cwd, '.env'), 'local value\n');
    writeFileSync(join(repo.cwd, 'private.txt'), 'do not copy\n');
    writeFileSync(join(repo.cwd, 'large.bin'), '');
    truncateSync(join(repo.cwd, 'large.bin'), 50 * 1024 * 1024 + 1);

    const result = await resolve(repo, { kind: 'worktree', branch: 'main', name: 'ormi/include' });
    assert.ok(!('err' in result), JSON.stringify(result));
    assert.equal(readFileSync(join(result.cwd, '.env'), 'utf8'), 'local value\n');
    assert.equal(existsSync(join(result.cwd, 'private.txt')), false);
    assert.equal(existsSync(join(result.cwd, 'large.bin')), false);
    const include = result.steps?.find(step => step.step === 'include');
    assert.equal(include?.status, 'warn');
    assert.match(include?.detail ?? '', /large\.bin/);
  } finally { repo.cleanup(); }
});

test('a failing setup script removes the new worktree and its branch and returns the output tail', async () => {
  const repo = fixture();
  try {
    mkdirSync(join(repo.cwd, '.ormi'), { recursive: true });
    writeFileSync(join(repo.cwd, '.ormi', 'setup'), 'printf "setup line one\\nsetup line two\\n"; exit 7\n');
    const result = await resolve(repo, { kind: 'worktree', branch: 'main', name: 'ormi/setup-failure' });
    assert.deepEqual(result.err, 'workspace.setup_failed');
    assert.match(result.detail ?? '', /setup: exited with code 7/);
    assert.match(result.detail ?? '', /setup line one/);
    assert.equal(existsSync(join(repo.cwd, '.ormi', 'worktrees', 'ormi-setup-failure')), false);
    assert.equal(git(repo.cwd, 'branch', '--list', 'ormi/setup-failure'), '');
  } finally { repo.cleanup(); }
});

test('existing worktree choice accepts registered linked worktrees and rejects the main checkout', async () => {
  const repo = fixture();
  try {
    const created = await resolve(repo, { kind: 'worktree', branch: 'main', name: 'ormi/existing' });
    assert.ok(!('err' in created), JSON.stringify(created));
    const selected = await resolve(repo, { kind: 'existing', path: created.cwd });
    assert.ok(!('err' in selected), JSON.stringify(selected));
    assert.equal(selected.cwd, created.cwd);
    assert.equal(selected.worktree, created.cwd);
    assert.equal(selected.branch, created.branch);

    const main = await resolve(repo, { kind: 'existing', path: repo.cwd });
    assert.equal(main.err, 'workspace.failed');
    assert.match(main.detail ?? '', /main checkout/);
  } finally { repo.cleanup(); }
});

test('includeDirty is rejected unless the worktree base is the main checkout branch', async () => {
  const repo = fixture();
  try {
    const result = await resolve(repo, {
      kind: 'worktree', branch: 'origin/main', name: 'ormi/wrong-base', includeDirty: true,
    });
    assert.equal(result.err, 'workspace.failed');
    assert.match(result.detail ?? '', /copy_dirty/);
  } finally { repo.cleanup(); }
});

test('checkout switches local branches and creates a tracking branch from remote refs', async () => {
  const repo = fixture();
  try {
    git(repo.cwd, 'branch', 'feature');
    const local = await resolve(repo, { kind: 'checkout', branch: 'feature' });
    assert.ok(!('err' in local), JSON.stringify(local));
    assert.equal(local.branch, 'feature');
    assert.equal(local.baseBranch, 'feature');

    git(repo.cwd, 'switch', 'main');
    const remote = `${repo.root}/remote-checkout`;
    execFileSync('git', ['clone', '-q', repo.origin, remote]);
    git(remote, 'config', 'user.name', 'Git Test');
    git(remote, 'config', 'user.email', 'git-test@example.com');
    git(remote, 'switch', '-c', 'remote-only');
    git(remote, 'push', '-u', 'origin', 'remote-only');
    git(repo.cwd, 'fetch', 'origin');
    const tracked = await resolve(repo, { kind: 'checkout', branch: 'origin/remote-only' });
    assert.ok(!('err' in tracked), JSON.stringify(tracked));
    assert.equal(tracked.branch, 'remote-only');
    assert.equal(git(repo.cwd, 'rev-parse', '--abbrev-ref', 'remote-only@{upstream}'), 'origin/remote-only');
    assert.deepEqual(await resolve(repo, { kind: 'checkout', branch: 'origin/main' }), {
      err: 'workspace.branch_exists', detail: 'Local branch main already exists; choose it instead of origin/main',
    });
  } finally { repo.cleanup(); }
});

test('checkout relays Git dirty-conflict text without changing the main checkout', async () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo.cwd, 'conflict.txt'), 'base\n');
    git(repo.cwd, 'add', 'conflict.txt'); git(repo.cwd, 'commit', '-m', 'add conflict file');
    git(repo.cwd, 'switch', '-c', 'feature');
    writeFileSync(join(repo.cwd, 'conflict.txt'), 'feature\n');
    git(repo.cwd, 'commit', '-am', 'change tracked file');
    git(repo.cwd, 'switch', 'main');
    writeFileSync(join(repo.cwd, 'conflict.txt'), 'dirty local\n');
    const result = await resolve(repo, { kind: 'checkout', branch: 'feature' });
    assert.equal(result.err, 'workspace.dirty_conflict');
    assert.match(result.detail, /would be overwritten/i);
    assert.equal(git(repo.cwd, 'branch', '--show-current'), 'main');
    assert.equal(readFileSync(join(repo.cwd, 'conflict.txt'), 'utf8'), 'dirty local\n');
  } finally { repo.cleanup(); }
});

test('skipInclude and skipSetup journal skipped steps and omit both operations', async () => {
  const repo = fixture();
  try {
    writeFileSync(join(repo.cwd, '.gitignore'), '.env\n');
    writeFileSync(join(repo.cwd, '.worktreeinclude'), '.env\n');
    writeFileSync(join(repo.cwd, '.env'), 'local secret\n');
    mkdirSync(join(repo.cwd, '.ormi'), { recursive: true });
    writeFileSync(join(repo.cwd, '.ormi', 'setup'), 'printf ran > setup-ran\n');

    const result = await resolve(repo, {
      kind: 'worktree', branch: 'main', name: 'ormi/skipped-preparation', skipInclude: true, skipSetup: true,
    });
    assert.ok(!('err' in result), JSON.stringify(result));
    assert.equal(existsSync(join(result.cwd, '.env')), false);
    assert.equal(existsSync(join(result.cwd, 'setup-ran')), false);
    assert.equal(result.steps?.find(step => step.step === 'include')?.status, 'skipped');
    assert.equal(result.steps?.find(step => step.step === 'setup')?.status, 'skipped');
  } finally { repo.cleanup(); }
});
