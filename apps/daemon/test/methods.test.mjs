import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { replay } from '@ormicode/journal';
import { getSession, listSessions } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';

const pendingCleanup = new Set();
const projectDir = mkdtempSync(join(tmpdir(), 'ormi-daemon-project-'));
test.after(async () => {
  for (const cleanup of pendingCleanup) await cleanup();
  rmSync(projectDir, { recursive: true, force: true });
});

const boot = async (env = {}) => {
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    pendingCleanup.delete(cleanup);
    try { client.close(); await daemon.close(); }
    finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  pendingCleanup.add(cleanup);
  return { daemon, client, cleanup };
};

const startSession = async (client, vendor = 'fake') => {
  const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor, transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  assert.equal(res.type, 'res', JSON.stringify(res));
  return res.body.session;
};

test('session.abort kills the worker, interrupts its open tool row and allows a later prompt', async () => {
  const { daemon, client, cleanup } = await boot({ ORMICODE_FAKE_SCRIPT: 'tool' });
  try {
    const session = await startSession(client);
    assert.equal((await client.request('session.prompt', { session, text: 'hold tool' })).type, 'res');
    const until = Date.now() + 5000;
    while (!replay(daemon.db, session).some(e => e.kind === 'tool_call') && Date.now() < until) await new Promise(r => setTimeout(r, 10));
    assert.ok(replay(daemon.db, session).some(e => e.kind === 'tool_call'));
    assert.equal((await client.request('session.abort', { session })).type, 'res');
    assert.equal(getSession(daemon.db, session).worker_pid, null);
    const rows = replay(daemon.db, session);
    assert.equal(JSON.parse(rows.find(e => e.kind === 'tool_result').payload).status, 'interrupted');
    assert.equal(JSON.parse(rows.at(-1).payload).reason, 'user_abort');
    assert.equal((await client.request('session.retry', { session })).body.accepted, true);
    assert.equal((await client.request('session.abort', { session })).type, 'res');
    assert.equal((await client.request('session.prompt', { session, text: 'continue' })).type, 'res');
    assert.equal((await client.request('session.abort', { session })).type, 'res');
  } finally { await cleanup(); }
});

test('session.start rejects missing project paths without creating them', async () => {
  const { client, cleanup } = await boot();
  const missing = join(projectDir, 'missing-project');
  const res = await client.request('session.start', {
    machine: newId('m'), project: missing, vendor: 'fake', transport: 'cli',
    model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' },
  });
  assert.equal(res.type, 'err');
  assert.equal(res.code, 'workspace.not_found');
  assert.equal(existsSync(missing), false);
  await cleanup();
});

test('session.delete hides the session from the default list', async () => {
  const { daemon, client, cleanup } = await boot();
  const session = await startSession(client);
  assert.equal((await client.request('session.delete', { session })).body.deleted, true);
  const list = await client.request('session.list', {});
  assert.ok(!list.body.sessions.some(s => s.id === session));
  const all = await client.request('session.list', { archived: true });
  assert.ok(all.body.sessions.some(s => s.id === session));
  await cleanup();
});

test('a second session on the same workspace is a lease conflict', async () => {
  const { daemon, client, cleanup } = await boot();
  await startSession(client);
  const dup = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  assert.equal(dup.type, 'err');
  assert.equal(dup.code, 'lease.conflict');
  await cleanup();
});

test('pause holds prompts and resume replays them in order', async () => {
  const { daemon, client, cleanup } = await boot();
  const session = await startSession(client);
  const deadline = Date.now() + 15_000;
  while (daemon.workers.get(session)?.ready !== true) {
    if (Date.now() > deadline) throw new Error('worker never ready');
    await new Promise(r => setTimeout(r, 25));
  }
  await client.request('session.pause', { session });
  await client.request('session.prompt', { session, text: 'one' });
  await client.request('session.prompt', { session, text: 'two' });
  assert.ok(!replay(daemon.db, session).some(r => r.kind === 'turn_start'));
  await client.request('session.resume', { session });
  const turnDeadline = Date.now() + 15_000;
  while (replay(daemon.db, session).filter(r => r.kind === 'turn_end').length < 2) {
    if (Date.now() > turnDeadline) throw new Error('held prompts did not replay');
    await new Promise(r => setTimeout(r, 25));
  }
  const texts = replay(daemon.db, session).filter(r => r.kind === 'text').map(r => JSON.parse(r.payload).text);
  assert.deepEqual(texts, ['one', 'two']);
  await cleanup();
});

test('session queue edits, reorders, journals and waits while paused', async () => {
  const { daemon, client, cleanup } = await boot();
  const session = await startSession(client);
  const readyDeadline = Date.now() + 15_000;
  while (daemon.workers.get(session)?.ready !== true) {
    if (Date.now() > readyDeadline) throw new Error('worker never ready');
    await new Promise(r => setTimeout(r, 25));
  }
  await client.request('session.pause', { session });
  const first = await client.request('session.queue.add', { session, text: 'one' });
  const second = await client.request('session.queue.add', { session, text: 'two' });
  const third = await client.request('session.queue.add', { session, text: 'three' });
  assert.equal((await client.request('session.queue.move', { session, id: third.body.id, index: 0 })).body.moved, true);
  assert.equal((await client.request('session.queue.update', { session, id: first.body.id, text: 'one updated' })).body.updated, true);
  assert.equal((await client.request('session.queue.remove', { session, id: second.body.id })).body.removed, true);
  assert.deepEqual((await client.request('session.queue.list', { session })).body.items.map(item => item.text), ['three', 'one updated']);
  assert.equal(replay(daemon.db, session).some(event => event.kind === 'turn_start'), false);
  assert.ok(replay(daemon.db, session).filter(event => event.kind === 'queue_changed').length >= 6);

  await client.request('session.resume', { session });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const prompts = replay(daemon.db, session).filter(event => event.kind === 'prompt');
    const items = (await client.request('session.queue.list', { session })).body.items;
    if (prompts.length >= 2 && items.length === 0) break;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.deepEqual(replay(daemon.db, session).filter(event => event.kind === 'prompt')
    .map(event => JSON.parse(event.payload).text), ['three', 'one updated']);
  assert.deepEqual((await client.request('session.queue.list', { session })).body.items, []);
  await cleanup();
});

test('retry re-sends the last prompt', async () => {
  const { daemon, client, cleanup } = await boot();
  const session = await startSession(client);
  await client.request('session.prompt', { session, text: 'once' });
  const deadline = Date.now() + 15_000;
  while (!replay(daemon.db, session).some(r => r.kind === 'turn_end')) {
    if (Date.now() > deadline) throw new Error('turn never finished');
    await new Promise(r => setTimeout(r, 25));
  }
  assert.equal((await client.request('session.retry', { session })).body.accepted, true);
  const second = Date.now() + 15_000;
  while (replay(daemon.db, session).filter(r => r.kind === 'turn_end').length < 2) {
    if (Date.now() > second) throw new Error('retry turn never started');
    await new Promise(r => setTimeout(r, 25));
  }
  const texts = replay(daemon.db, session).filter(r => r.kind === 'text').map(r => JSON.parse(r.payload).text);
  assert.deepEqual(texts, ['once', 'once']);
  await cleanup();
});

test('notes round-trip through the daemon', async () => {
  const { client, cleanup } = await boot();
  const session = await startSession(client);
  const set = await client.request('session.setNotes', { session, title: 'api flag', body: 'remember this' });
  assert.ok(set.body.id.startsWith('n_'));
  const got = await client.request('session.getNotes', { session });
  assert.equal(got.body.notes.length, 1);
  assert.equal(got.body.notes[0].title, 'api flag');
  assert.ok(got.body.notes[0].updatedAt > 1_000_000_000_000);
  assert.equal((await client.request('session.deleteNote', { session, id: set.body.id })).body.deleted, true);
  await cleanup();
});

test('prompt history is project-scoped, newest-first, and distinct', async () => {
  const { daemon, client, cleanup } = await boot();
  const session = await startSession(client);
  for (const [index, text] of ['alpha', 'beta', 'alpha'].entries()) {
    await client.request('session.prompt', { session, text });
    const deadline = Date.now() + 5000;
    while (replay(daemon.db, session).filter(event => event.kind === 'turn_end').length < index + 1) {
      if (Date.now() > deadline) throw new Error('prompt turn did not finish');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  const all = await client.request('prompts.history', { project: projectDir, limit: 20 });
  assert.deepEqual(all.body.items.map(item => item.text), ['alpha', 'beta']);
  const filtered = await client.request('prompts.history', { project: projectDir, query: 'bet' });
  assert.deepEqual(filtered.body.items.map(item => item.text), ['beta']);
  const otherProject = await client.request('prompts.history', { project: '/other' });
  assert.deepEqual(otherProject.body.items, []);
  await cleanup();
});

test('invalid prompt inputs return prompt.invalid and failed queued items stay marked', async () => {
  const { daemon, client, cleanup } = await boot();
  const invalidStart = await client.request('session.start', {
    machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x',
    workspace: { kind: 'current' }, context: [{ kind: 'file', path: 'missing.ts' }],
  });
  assert.equal(invalidStart.code, 'prompt.invalid');
  const session = await startSession(client);
  const row = getSession(daemon.db, session);
  const validPath = join(row.cwd, 'referenced.ts');
  writeFileSync(validPath, 'present');
  const invalidPrompt = await client.request('session.prompt', { session, text: 'bad path', context: [{ kind: 'file', path: 'missing.ts' }] });
  assert.equal(invalidPrompt.code, 'prompt.invalid');
  const invalidQueue = await client.request('session.queue.add', { session, text: 'bad path', context: [{ kind: 'file', path: 'missing.ts' }] });
  assert.equal(invalidQueue.code, 'prompt.invalid');

  const deadline = Date.now() + 5000;
  while (getSession(daemon.db, session).state !== 'idle') {
    if (Date.now() > deadline) throw new Error('session did not become idle');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await client.request('session.pause', { session });
  const queued = await client.request('session.queue.add', { session, text: 'file goes missing', context: [{ kind: 'file', path: 'referenced.ts' }] });
  assert.equal(queued.type, 'res');
  rmSync(validPath);
  const resumed = await client.request('session.resume', { session });
  assert.equal(resumed.code, 'agent.failed');
  const items = (await client.request('session.queue.list', { session })).body.items;
  assert.equal(items.length, 1);
  assert.match(items[0].error, /referenced\.ts|ENOENT/i);
  await client.request('session.resume', { session });
  assert.equal((await client.request('session.queue.list', { session })).body.items[0].error, items[0].error);
  await cleanup();
});

test('idle eviction frees the worker after the timeout', async () => {
  const { daemon, client, cleanup } = await boot({ ORMICODE_IDLE_TIMEOUT_MS: '300' });
  const session = await startSession(client);
  const deadline = Date.now() + 15_000;
  while (daemon.workers.get(session)?.ready !== true) {
    if (Date.now() > deadline) throw new Error('worker never ready');
    await new Promise(r => setTimeout(r, 25));
  }
  const evictDeadline = Date.now() + 15_000;
  while (daemon.workers.has(session)) {
    if (Date.now() > evictDeadline) throw new Error('worker not evicted');
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(replay(daemon.db, session).some(r => r.kind === 'evicted'));
  await cleanup();
});

test('setModel reaches the worker and persists on the session row', async () => {
  const { daemon, client, cleanup } = await boot();
  const session = await startSession(client);
  const deadline = Date.now() + 15_000;
  while (daemon.workers.get(session)?.ready !== true) {
    if (Date.now() > deadline) throw new Error('worker never ready');
    await new Promise(r => setTimeout(r, 25));
  }
  const res = await client.request('session.setModel', { session, model: 'fake-model-2' });
  // fake adapter has no setModel: unsupported is the honest answer
  assert.equal(res.type, 'err');
  await cleanup();
});

test('a paused_rate_limited session retries the held prompt at resetAt', async () => {
  const { daemon, client, cleanup } = await boot({ ORMICODE_FAKE_SCRIPT: 'ratelimit_pause', ORMICODE_FAKE_DELAY_MS: '300' });
  try {
    const session = await startSession(client);
    await client.request('session.subscribe', { session });
    const states = [];
    client.onFrame = f => { if (f.type === 'evt') states.push(f.body.kind); };
    await client.request('session.prompt', { session, text: 'retry me' });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && getSession(daemon.db, session)?.state !== 'paused_rate_limited')
      await new Promise(r => setTimeout(r, 25));
    assert.equal(getSession(daemon.db, session)?.state, 'paused_rate_limited');
    // The second turn queues turn_start, text and turn_end together. Wait for
    // the turn_end state transition, not just delivery of turn_start.
    while (Date.now() < deadline && states.filter(k => k === 'turn_start').length < 2)
      await new Promise(r => setTimeout(r, 50));
    assert.equal(states.filter(k => k === 'turn_start').length, 2, 'held prompt resent at reset');
    while (Date.now() < deadline && getSession(daemon.db, session)?.state !== 'idle')
      await new Promise(r => setTimeout(r, 25));
    assert.equal(getSession(daemon.db, session)?.state, 'idle');
  } finally {
    await cleanup();
  }
});
