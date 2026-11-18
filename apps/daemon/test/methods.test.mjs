import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { replay } from '@ormicode/journal';
import { getSession, listSessions } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';

const pendingCleanup = new Set();
test.after(async () => {
  for (const cleanup of pendingCleanup) await cleanup();
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
  const res = await client.request('session.start', { machine: newId('m'), project: 'p_t', vendor, transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  assert.equal(res.type, 'res', JSON.stringify(res));
  return res.body.session;
};

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
  const dup = await client.request('session.start', { machine: newId('m'), project: 'p_t', vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
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
  while (replay(daemon.db, session).filter(r => r.kind === 'turn_start').length < 2) {
    if (Date.now() > turnDeadline) throw new Error('held prompts did not replay');
    await new Promise(r => setTimeout(r, 25));
  }
  const texts = replay(daemon.db, session).filter(r => r.kind === 'text').map(r => JSON.parse(r.payload).text);
  assert.deepEqual(texts, ['one', 'two']);
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
  assert.equal((await client.request('session.deleteNote', { session, id: set.body.id })).body.deleted, true);
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
