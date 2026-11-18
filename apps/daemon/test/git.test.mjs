import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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

test('Git pane methods, fake PR status and terminal.open session cwd', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-git-pane-'));
  const project = join(dir, 'project');
  execFileSync('git', ['init', '-q', '-b', 'main', project]);
  writeFileSync(join(project, 'file.txt'), 'base\n');
  git(project, 'add', 'file.txt');
  git(project, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'base');
  const gh = join(dir, 'fake-gh');
  writeFileSync(gh, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  number: 17, title: 'Test PR', body: 'Description', state: 'OPEN', isDraft: false,
  url: 'https://example.test/pull/17', headRefName: 'main', baseRefName: 'main',
  author: { login: 'author' }, createdAt: '2026-01-02T03:04:05Z',
  statusCheckRollup: [{ name: 'checks', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-01-02T03:00:00Z', completedAt: '2026-01-02T03:02:00Z' }],
  reviews: [{ author: { login: 'reviewer' }, state: 'APPROVED' }],
  reviewRequests: [{ requestedReviewer: { login: 'requested' } }],
  additions: 3, deletions: 1, changedFiles: 2
}));
`);
  chmodSync(gh, 0o755);
  const envKeys = ['ORMICODE_HOME', 'ORMICODE_FAKE_SCRIPT', 'ORMICODE_FAKE_DELAY_MS', 'ORMICODE_PRICES_URL', 'ORMICODE_GH'];
  const oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    ORMICODE_HOME: join(dir, 'home'), ORMICODE_FAKE_SCRIPT: 'tool',
    ORMICODE_FAKE_DELAY_MS: '1200', ORMICODE_PRICES_URL: 'off', ORMICODE_GH: gh,
  });
  const { daemon, client } = await boot(dir);
  try {
    const started = await start(client, project, { kind: 'current' });
    const session = started.body.session;
    const waitFor = async fn => {
      const end = Date.now() + 10_000;
      while (Date.now() < end) {
        const value = await fn();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error('timed out waiting for session');
    };
    await waitFor(async () => (await client.request('session.get', { session })).body.state === 'idle');
    assert.equal((await client.request('git.status', { session })).body.branch, 'main');
    writeFileSync(join(project, 'new.txt'), 'new\n');
    assert.equal((await client.request('git.stage', { session, paths: ['new.txt'] })).type, 'res');
    const created = await client.request('git.commit', { session, message: 'add new file' });
    assert.match(created.body.sha, /^[0-9a-f]{40}$/);
    assert.equal((await client.request('git.log', { session })).body.commits[0].subject, 'add new file');
    assert.equal((await client.request('git.show', { session, sha: created.body.sha })).body.files[0].path, 'new.txt');

    await client.request('git.createBranch', { session, name: 'pane/branch' });
    assert.equal((await client.request('session.get', { session })).body.branch, 'pane/branch');
    await client.request('git.checkout', { session, branch: 'main' });
    assert.equal((await client.request('git.deleteBranch', { session, name: 'pane/branch', confirm: 'wrong' })).code, 'git.confirm_required');
    assert.equal((await client.request('git.deleteBranch', { session, name: 'pane/branch', confirm: 'pane/branch' })).type, 'res');

    const pr = (await client.request('git.prStatus', { session })).body.pr;
    assert.equal(pr.number, 17);
    assert.equal(pr.checks[0].durationMs, 120_000);
    assert.deepEqual(pr.reviewers.map(r => r.state), ['approved', 'requested']);

    writeFileSync(join(project, 'busy.txt'), 'busy\n');
    await client.request('session.prompt', { session, text: 'wait briefly' });
    await waitFor(async () => (await client.request('session.get', { session })).body.state === 'running');
    assert.equal((await client.request('git.stage', { session, paths: ['busy.txt'] })).code, 'checkpoint.busy');
    await waitFor(async () => (await client.request('session.get', { session })).body.state === 'idle');

    assert.equal((await client.request('terminal.open', {})).code, 'terminal.bad_request');
    const terminal = await client.request('terminal.open', { session, shell: '/bin/sh', args: ['-c', 'sleep 5'] });
    assert.equal(terminal.type, 'res', JSON.stringify(terminal));
    assert.equal(terminal.body.cwd, project);
    await client.request('terminal.close', { terminal: terminal.body.terminal });
  } finally {
    client.close();
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
