import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDaemon, connect } from '../src/index.ts';
import { getSession } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'ormi-branch-api-'));
  const project = join(root, 'repo');
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '-b', 'main', project]);
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
  git(project, 'config', 'user.name', 'Git Test');
  git(project, 'config', 'user.email', 'git-test@example.com');
  writeFileSync(join(project, 'tracked.txt'), 'base\n');
  git(project, 'add', '.'); git(project, 'commit', '-m', 'base');
  git(project, 'remote', 'add', 'origin', origin);
  git(project, 'push', '-u', 'origin', 'main');
  git(project, 'remote', 'set-head', 'origin', '--auto');
  return { root, project, origin, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function boot(root) {
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(root, 'store.db') });
  return { daemon, client: await connect(daemon.socketPath) };
}

const start = (client, project, workspace) => client.request('session.start', {
  machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace,
});

test('project pull fast-forwards current and other branches and reports upstream errors', async () => {
  const repo = repository();
  const update = (branch, file) => {
    const clone = join(repo.root, `clone-${branch}`);
    execFileSync('git', ['clone', '-q', '-b', branch, repo.origin, clone]);
    git(clone, 'config', 'user.name', 'Git Test');
    git(clone, 'config', 'user.email', 'git-test@example.com');
    writeFileSync(join(clone, file), `${branch} update\n`);
    git(clone, 'add', '.'); git(clone, 'commit', '-m', `${branch} update`); git(clone, 'push');
    return git(clone, 'rev-parse', 'HEAD');
  };
  const { daemon, client } = await boot(repo.root);
  try {
    const currentHead = update('main', 'remote-main.txt');
    const current = await client.request('project.pull', { project: repo.project, branch: 'main' });
    assert.equal(current.type, 'res');
    assert.deepEqual(current.body, { updated: true, from: current.body.from, to: currentHead });
    assert.notEqual(current.body.from, current.body.to);

    git(repo.project, 'switch', '-c', 'feature');
    git(repo.project, 'push', '-u', 'origin', 'feature');
    const featureHead = update('feature', 'remote-feature.txt');
    const other = await client.request('project.pull', { project: repo.project, branch: 'feature' });
    assert.equal(other.type, 'res');
    assert.equal(other.body.to, featureHead);

    git(repo.project, 'switch', '-c', 'no-upstream');
    const missing = await client.request('project.pull', { project: repo.project, branch: 'no-upstream' });
    assert.equal(missing.code, 'git.no_upstream');
  } finally { await daemon.close(); client.close(); repo.cleanup(); }
});

test('project branch actions validate, protect in-use refs, and require force for unmerged deletion', async () => {
  const repo = repository();
  const { daemon, client } = await boot(repo.root);
  try {
    git(repo.project, 'branch', 'rename-me');
    const initialCatalog = await client.request('project.branches', { project: repo.project });
    assert.equal(initialCatalog.body.local.find(branch => branch.name === 'rename-me')?.merged, true);
    const renamed = await client.request('project.renameBranch', { project: repo.project, from: 'rename-me', to: 'renamed' });
    assert.equal(renamed.type, 'res');
    const invalid = await client.request('project.renameBranch', { project: repo.project, from: 'renamed', to: 'bad name' });
    assert.equal(invalid.code, 'git.invalid_branch');

    git(repo.project, 'switch', '-c', 'linked');
    git(repo.project, 'worktree', 'add', '-b', 'in-worktree', join(repo.root, 'linked-worktree'));
    const worktreeCatalog = await client.request('project.branches', { project: repo.project });
    assert.equal(worktreeCatalog.body.local.find(branch => branch.name === 'in-worktree')?.worktreePath, join(repo.root, 'linked-worktree'));
    const inUse = await client.request('project.renameBranch', { project: repo.project, from: 'in-worktree', to: 'renamed-worktree' });
    assert.equal(inUse.code, 'git.branch_in_use');
    const current = await client.request('project.deleteBranch', { project: repo.project, name: 'linked', confirm: 'linked' });
    assert.equal(current.code, 'git.branch_in_use');
    const worktreeDelete = await client.request('project.deleteBranch', { project: repo.project, name: 'in-worktree', confirm: 'in-worktree' });
    assert.equal(worktreeDelete.code, 'git.branch_in_use');
    const wrongConfirm = await client.request('project.deleteBranch', { project: repo.project, name: 'renamed', confirm: 'other' });
    assert.equal(wrongConfirm.code, 'git.confirm_required');

    git(repo.project, 'switch', '-c', 'unmerged');
    writeFileSync(join(repo.project, 'unmerged.txt'), 'change\n');
    git(repo.project, 'add', '.'); git(repo.project, 'commit', '-m', 'unmerged');
    git(repo.project, 'switch', 'linked');
    const refused = await client.request('project.deleteBranch', { project: repo.project, name: 'unmerged', confirm: 'unmerged' });
    assert.equal(refused.code, 'git.unmerged');
    const forced = await client.request('project.deleteBranch', { project: repo.project, name: 'unmerged', confirm: 'unmerged', force: true });
    assert.equal(forced.type, 'res');
  } finally { await daemon.close(); client.close(); repo.cleanup(); }
});

test('checkout refuses to switch the main checkout while a live session holds it', async () => {
  const repo = repository();
  const { daemon, client } = await boot(repo.root);
  try {
    git(repo.project, 'branch', 'feature');
    const running = await start(client, repo.project, { kind: 'current' });
    assert.equal(running.type, 'res');
    assert.equal(getSession(daemon.db, running.body.session).cwd, repo.project);
    const rename = await client.request('project.renameBranch', { project: repo.project, from: 'main', to: 'renamed-main' });
    assert.equal(rename.code, 'git.branch_in_use');
    const pull = await client.request('project.pull', { project: repo.project, branch: 'main' });
    assert.equal(pull.code, 'git.branch_in_use');
    const switched = await start(client, repo.project, { kind: 'checkout', branch: 'feature' });
    assert.equal(switched.type, 'err');
    assert.equal(switched.code, 'workspace.busy');
  } finally { await daemon.close(); client.close(); repo.cleanup(); }
});
