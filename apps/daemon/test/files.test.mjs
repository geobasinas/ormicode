import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { createSession, getSession } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'ormi-files-daemon-repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'File Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'files@example.test'], { cwd: root });
  writeFileSync(join(root, 'note.txt'), 'before');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: root });
  return root;
}

const restoreEnv = previous => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

test('file.write journals a manual checkpoint and file_edit event', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-files-daemon-'));
  const root = repo();
  const keys = ['ORMICODE_HOME', 'ORMICODE_CHECKPOINTS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.ORMICODE_HOME = join(dir, 'home');
  process.env.ORMICODE_CHECKPOINTS = '1';
  let daemon;
  let client;
  t.after(async () => {
    try {
      client?.close();
      await daemon?.close();
    } finally {
      restoreEnv(previous);
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    }
  });

  daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  client = await connect(daemon.socketPath);
  const session = newId('s');
  createSession(daemon.db, {
    id: session, machine: newId('m'), project: root, vendor: 'fake', transport: 'cli', model: 'x', cwd: root,
  });
  const baseMtime = Math.round(statSync(join(root, 'note.txt')).mtimeMs);
  const result = await client.request('file.write', { session, path: 'note.txt', content: 'after', baseMtime });
  assert.equal(result.type, 'res');
  assert.ok(result.body.checkpoint);
  assert.equal(getSession(daemon.db, session)?.state, 'idle');
  const events = replay(daemon.db, session);
  const checkpoint = events.find(event => event.kind === 'checkpoint');
  const edited = events.find(event => event.kind === 'file_edit');
  assert.ok(checkpoint);
  assert.ok(edited);
  assert.deepEqual(JSON.parse(checkpoint.payload), {
    kind: 'checkpoint', id: result.body.checkpoint, seq: 0, tool: 'manual edit',
  });
  assert.deepEqual(JSON.parse(edited.payload), {
    kind: 'file_edit', path: 'note.txt', size: 5, checkpoint: result.body.checkpoint,
  });
  writeFileSync(join(root, 'note.txt'), 'changed again');
  const restored = await client.request('checkpoint.restore', { session, id: result.body.checkpoint, mode: 'files' });
  assert.equal(restored.type, 'res');
  assert.equal(readFileSync(join(root, 'note.txt'), 'utf8'), 'after');
  const empty = await client.request('file.write', { session, path: 'note.txt', content: '' });
  assert.equal(empty.type, 'res'); assert.ok(empty.body.checkpoint);
  writeFileSync(join(root, 'note.txt'), 'not empty');
  assert.equal((await client.request('checkpoint.restore', { session, id: empty.body.checkpoint, mode: 'files' })).type, 'res');
  assert.equal(readFileSync(join(root, 'note.txt'), 'utf8'), '');
  const count = replay(daemon.db, session).filter(event => event.kind === 'checkpoint').length;
  const rejected = await client.request('file.write', { session, path: 'note.txt', content: 'conflict', baseMtime: 1 });
  assert.equal(rejected.code, 'file.conflict');
  assert.equal(readFileSync(join(root, 'note.txt'), 'utf8'), '');
  assert.equal(replay(daemon.db, session).filter(event => event.kind === 'checkpoint').length, count);
});

test('project.searchFiles returns folders and files before a session exists', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-project-search-'));
  const root = repo();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.ts'), 'export {};\n');
  const keys = ['ORMICODE_HOME'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.ORMICODE_HOME = join(dir, 'home');
  let daemon;
  let client;
  t.after(async () => {
    client?.close();
    await daemon?.close();
    restoreEnv(previous);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  });
  daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  client = await connect(daemon.socketPath);
  const result = await client.request('project.searchFiles', { project: root, query: 'src', limit: 50 });
  assert.equal(result.type, 'res');
  assert.equal(result.body.files.some(file => file.path === 'src' && file.kind === 'folder'), true);
  assert.equal(result.body.files.some(file => file.path === 'src/main.ts' && file.kind === 'file'), true);
});

test('file.write returns file.busy during a slow agent turn', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-files-daemon-slow-'));
  const root = repo();
  const keys = ['ORMICODE_HOME', 'ORMICODE_CHECKPOINTS', 'ORMICODE_FAKE_SCRIPT', 'ORMICODE_FAKE_DELAY_MS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.ORMICODE_HOME = join(dir, 'home');
  process.env.ORMICODE_CHECKPOINTS = '0';
  process.env.ORMICODE_FAKE_SCRIPT = 'slow';
  process.env.ORMICODE_FAKE_DELAY_MS = '10000';
  let daemon;
  let client;
  t.after(async () => {
    try {
      client?.close();
      await daemon?.close();
    } finally {
      restoreEnv(previous);
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    }
  });

  daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  client = await connect(daemon.socketPath);
  const started = await client.request('session.start', {
    machine: newId('m'), project: root, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x',
    workspace: { kind: 'current' },
  });
  assert.equal(started.type, 'res');
  const session = started.body.session;
  await client.request('session.prompt', { session, text: 'hold this turn' });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && getSession(daemon.db, session)?.state !== 'running')
    await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(getSession(daemon.db, session)?.state, 'running');
  const result = await client.request('file.write', { session, path: 'note.txt', content: 'unsafe during turn' });
  assert.equal(result.type, 'err');
  assert.equal(result.code, 'file.busy');
});
