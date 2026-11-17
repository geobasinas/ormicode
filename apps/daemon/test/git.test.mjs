import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { getSession } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-git-test-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'f.txt'), 'one');
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'init');
  return dir;
}

const start = (client, project, workspace, workspaceName) =>
  client.request('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace, ...(workspaceName ? { workspaceName } : {}) });

async function boot(storeDir) {
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(storeDir, 'store.db') });
  return { daemon, client: await connect(daemon.socketPath) };
}

test('current on a clean repo records branch and starting commit', async () => {
  const dir = repo();
  const { daemon, client } = await boot(dir);
  const res = await start(client, dir, { kind: 'current' });
  assert.equal(res.type, 'res');
  const row = getSession(daemon.db, res.body.session);
  assert.equal(row.branch, 'main');
  assert.equal(row.base_branch, 'main');
  assert.equal(row.base_commit, git(dir, 'rev-parse', 'HEAD'));
  assert.equal(row.cwd, dir);
  await daemon.close(); client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('detached HEAD with kind current is rejected', async () => {
  const dir = repo();
  git(dir, 'checkout', '--detach', 'HEAD');
  const { daemon, client } = await boot(dir);
  const res = await start(client, dir, { kind: 'current' });
  assert.equal(res.type, 'err');
  assert.equal(res.code, 'workspace.detached');
  await daemon.close(); client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a busy branch auto-reserves a worktree at the recorded commit', async () => {
  const dir = repo();
  const commit = git(dir, 'rev-parse', 'HEAD');
  const { daemon, client } = await boot(dir);
  const first = await start(client, dir, { kind: 'current' });
  assert.equal(first.type, 'res');
  const second = await start(client, dir, { kind: 'current', workspaceName: 'fix bug' });
  assert.equal(second.type, 'res');
  const row = getSession(daemon.db, second.body.session);
  assert.ok(row.worktree && row.worktree.startsWith(join(dir, '.ormi', 'worktrees')), `worktree under .ormi, got ${row.worktree}`);
  assert.ok(existsSync(row.worktree), 'worktree exists');
  assert.equal(row.cwd, row.worktree);
  assert.equal(row.base_commit, commit);
  assert.equal(row.base_branch, 'main');
  assert.match(row.branch, /^ormi\//);
  assert.equal(git(row.worktree, 'rev-parse', 'HEAD'), commit, 'worktree at the recorded commit');
  await daemon.close(); client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('kind worktree creates .ormi/worktrees/<slug> and kind branch switches a new branch', async () => {
  const dir = repo();
  const { daemon, client } = await boot(dir);
  const wt = await start(client, dir, { kind: 'worktree', branch: 'main', workspaceName: 'feature' });
  assert.equal(wt.type, 'res');
  const row = getSession(daemon.db, wt.body.session);
  assert.ok(row.worktree.includes(join('.ormi', 'worktrees')));
  const br = await start(client, dir, { kind: 'branch', branch: 'hotfix-x' });
  assert.equal(br.type, 'res');
  const row2 = getSession(daemon.db, br.body.session);
  assert.equal(row2.cwd, dir, 'branch kind stays in the main checkout');
  assert.equal(row2.branch, 'hotfix-x');
  assert.equal(git(dir, 'branch', '--show-current'), row2.branch, 'checkout switched to the session branch');
  await daemon.close(); client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('non-git project rejects branch/worktree but allows current', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-git-test-'));
  const { daemon, client } = await boot(dir);
  const bad = await start(client, dir, { kind: 'worktree', branch: 'main' });
  assert.equal(bad.type, 'err');
  assert.equal(bad.code, 'workspace.not_repo');
  const ok = await start(client, dir, { kind: 'current' });
  assert.equal(ok.type, 'res');
  assert.equal(getSession(daemon.db, ok.body.session).branch, null);
  await daemon.close(); client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a failed worktree add cleans up and leaves the repo untouched', async () => {
  const dir = repo();
  // Break the worktree parent dir: .ormi exists as a file so mkdir/add fails.
  writeFileSync(join(dir, '.ormi'), 'occupied');
  const { daemon, client } = await boot(dir);
  const res = await start(client, dir, { kind: 'worktree', branch: 'main' });
  assert.equal(res.type, 'err');
  assert.equal(res.code, 'workspace.failed');
  assert.deepEqual(git(dir, 'worktree', 'list').split('\n').length, 1, 'no worktree registered');
  assert.deepEqual(git(dir, 'branch', '--list', 'ormi/*'), '', 'no branch leaked');
  await daemon.close(); client.close();
  rmSync(dir, { recursive: true, force: true });
});
