import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';

const cleanups = new Set();
test.after(async () => { for (const cleanup of cleanups) await cleanup(); });

async function boot(storePath = join(mkdtempSync(join(tmpdir(), 'ormi-machine-store-')), 'store.db')) {
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  const client = await connect(daemon.socketPath);
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    cleanups.delete(cleanup);
    client.close();
    await daemon.close();
  };
  cleanups.add(cleanup);
  return { client, cleanup };
}

test('machine.list and fs.browse expose only directories with hidden and git metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-browse-'));
  const { client, cleanup } = await boot();
  try {
    mkdirSync(join(root, 'Plain'));
    mkdirSync(join(root, '.hidden'));
    mkdirSync(join(root, 'repo', '.git'), { recursive: true });
    writeFileSync(join(root, 'file.txt'), 'not returned');
    let linked = true;
    try { symlinkSync(join(root, 'Plain'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
      linked = false;
    }

    const machines = await client.request('machine.list', {});
    assert.equal(machines.type, 'res');
    assert.equal(machines.body.machines.length, 1);
    assert.deepEqual(
      [machines.body.machines[0].id, machines.body.machines[0].kind, machines.body.machines[0].status],
      ['m_local', 'local', 'online'],
    );
    assert.equal(typeof machines.body.machines[0].heartbeat, 'number');

    const result = await client.request('fs.browse', { machine: 'm_local', path: root });
    assert.equal(result.type, 'res');
    assert.equal(result.body.parent, dirname(root));
    assert.deepEqual(result.body.entries.map(entry => entry.name), linked ? ['linked', 'Plain', 'repo'] : ['Plain', 'repo']);
    assert.equal(result.body.entries.find(entry => entry.name === 'repo').git, true);
    assert.equal(result.body.entries.some(entry => entry.name === 'file.txt' || entry.name === '.hidden'), false);
    assert.equal(result.body.entries.some(entry => entry.name === 'linked'), linked);
    assert.equal(JSON.stringify(result.body).includes('not returned'), false);
    assert.deepEqual(Object.keys(result.body.entries[0]).sort(), ['git', 'hidden', 'name', 'path']);
    const hidden = (await client.request('fs.browse', { machine: 'm_local', path: root, hidden: true }))
      .body.entries.find(entry => entry.name === '.hidden');
    assert.equal(hidden.hidden, true);
    assert.equal((await client.request('fs.browse', { machine: 'm_local' })).body.path, resolve(homedir()));
  } finally {
    await cleanup();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('fs.browse maps invalid paths, missing folders, files, and unknown machines', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-browse-errors-'));
  const file = join(root, 'file.txt');
  writeFileSync(file, 'file');
  const { client, cleanup } = await boot();
  try {
    const invalid = await client.request('fs.browse', { machine: 'm_local', path: 'relative' });
    assert.equal(invalid.code, 'fs.invalid_path');
    const missing = await client.request('fs.browse', { machine: 'm_local', path: join(root, 'missing') });
    assert.equal(missing.code, 'fs.not_found');
    const notDirectory = await client.request('fs.browse', { machine: 'm_local', path: file });
    assert.equal(notDirectory.code, 'fs.not_directory');
    const unreachable = await client.request('fs.browse', { machine: 'm_unknown', path: root });
    assert.equal(unreachable.code, 'machine.unreachable');
  } finally {
    await cleanup();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('project registry is idempotent, persistent, and never removes the folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-project-registry-'));
  const projectPath = join(root, 'repo');
  const storePath = join(root, 'store.db');
  mkdirSync(join(projectPath, '.git'), { recursive: true });
  let daemon = await boot(storePath);
  try {
    const added = await daemon.client.request('project.add', { machine: 'm_local', path: projectPath });
    assert.equal(added.type, 'res');
    assert.equal(added.body.project.git, true);
    const duplicate = await daemon.client.request('project.add', { machine: 'm_local', path: projectPath });
    assert.deepEqual(duplicate.body.project, added.body.project);
    assert.equal((await daemon.client.request('project.add', { machine: 'm_local', path: 'relative' })).code, 'fs.invalid_path');
    assert.equal((await daemon.client.request('project.add', { machine: 'm_unknown', path: projectPath })).code, 'machine.unreachable');
    assert.equal((await daemon.client.request('project.add', { machine: 'm_local', path: join(root, 'missing') })).code, 'fs.not_found');
    await daemon.cleanup();
    daemon = await boot(storePath);
    const listed = await daemon.client.request('project.list', {});
    assert.deepEqual(listed.body.projects, [added.body.project]);
    assert.equal((await daemon.client.request('project.remove', { machine: 'm_local', path: projectPath })).body.removed, true);
    assert.equal((await daemon.client.request('project.remove', { machine: 'm_local', path: projectPath })).body.removed, false);
    assert.equal(existsSync(projectPath), true);
  } finally {
    await daemon.cleanup();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});
