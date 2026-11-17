import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { replay } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';
import { getSession } from '@ormicode/session-store';

const boot = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  return { dir, daemon, client };
};

const events = async (client, session, untilKind, timeoutMs = 30_000) => {
  const seen = [];
  const deadline = Date.now() + timeoutMs;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${untilKind}; saw ${seen.map(e => e.body?.kind).join(',')}`)), Math.max(0, deadline - Date.now()));
    client.onFrame = frame => {
      if (frame.type === 'evt' && frame.session === session) {
        seen.push(frame);
        if (frame.body?.kind === untilKind) { clearTimeout(timer); resolve(seen); }
      }
    };
  });
};

test('fake session: start, prompt, turn events are journaled and replayable', async () => {
  const { daemon, client } = await boot();
  const started = await client.request('session.start', { machine: newId('m'), project: 'p_t', vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  assert.equal(started.type, 'res');
  const session = started.body.session;
  const collecting = events(client, session, 'turn_end');
  const sub = await client.request('session.subscribe', { session });
  assert.equal(sub.type, 'res');
  const prompted = await client.request('session.prompt', { session, text: 'say ok' });
  assert.equal(prompted.body.accepted, true);
  const seen = await collecting;
  const kinds = seen.map(f => f.body.kind);
  assert.ok(kinds.includes('turn_start') && kinds.includes('turn_end'));
  assert.deepEqual(replay(daemon.db, session).map(r => r.kind).filter(k => ['turn_start', 'turn_end'].includes(k)), ['turn_start', 'turn_end']);
  assert.equal(getSession(daemon.db, session)?.state, 'idle');
  assert.equal(getSession(daemon.db, session)?.native_id, 'fake-native-1');
  await daemon.close();
});

test('events survive a daemon restart with seq continuity', async () => {
  const { daemon, client, dir } = await boot();
  const started = await client.request('session.start', { machine: newId('m'), project: 'p_t', vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  const session = started.body.session;
  const collecting = events(client, session, 'turn_end');
  await client.request('session.subscribe', { session });
  await client.request('session.prompt', { session, text: 'hi' });
  await collecting;
  const socketPath = daemon.socketPath;
  await daemon.close();

  process.env.ORMICODE_RESUME_POLICY = 'wait';
  const daemon2 = await startDaemon({ socketPath, storePath: join(dir, 'store.db') });
  delete process.env.ORMICODE_RESUME_POLICY;
  const s = getSession(daemon2.db, session);
  assert.equal(s?.state, 'idle');
  assert.ok((s?.last_seq ?? 0) >= 3);
  assert.ok(replay(daemon2.db, session).length >= 3);
  await daemon2.close();
});

test('worker killed mid-turn marks the session interrupted with committed events kept', async () => {
  process.env.ORMICODE_FAKE_SCRIPT = 'slow';
  process.env.ORMICODE_FAKE_DELAY_MS = '60000';
  try {
    const { daemon, client } = await boot();
    const started = await client.request('session.start', { machine: newId('m'), project: 'p_t', vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
    const session = started.body.session;
    const collecting = events(client, session, 'interrupted');
    await client.request('session.subscribe', { session });
    await client.request('session.prompt', { session, text: 'wait' });
    // Wait for the turn to be running, then hard-kill the worker.
    const deadline = Date.now() + 30_000;
    while (daemon.workers.get(session)?.ready !== true) {
      if (Date.now() > deadline) throw new Error('worker never became ready');
      await new Promise(r => setTimeout(r, 25));
    }
    // Let turn_start actually land in the journal before the kill.
    const turnDeadline = Date.now() + 30_000;
    while (!replay(daemon.db, session).some(r => r.kind === 'turn_start')) {
      if (Date.now() > turnDeadline) throw new Error('turn never started');
      await new Promise(r => setTimeout(r, 25));
    }
    daemon.workers.get(session).proc.kill('SIGKILL');
    const seen = await collecting;
    assert.ok(seen.some(f => f.body.kind === 'interrupted'));
    assert.equal(getSession(daemon.db, session)?.state, 'interrupted');
    assert.ok(replay(daemon.db, session).some(r => r.kind === 'turn_start'));
    await daemon.close();
  } finally {
    delete process.env.ORMICODE_FAKE_SCRIPT;
    delete process.env.ORMICODE_FAKE_DELAY_MS;
  }
});

test('daemon.status and unknown methods respond correctly', async () => {
  const { daemon, client } = await boot();
  const status = await client.request('daemon.status', {});
  assert.equal(status.body.relay, 'disconnected');
  assert.equal(typeof status.body.uptimeMs, 'number');
  const bogus = await client.request('bogus.method', {});
  assert.equal(bogus.type, 'err');
  await daemon.close();
});

test('a completed session auto-resumes on daemon restart under the safe policy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const storePath = join(dir, 'store.db');
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  const client = await connect(daemon.socketPath);
  const res = await client.request('session.start', { machine: newId('m'), project: 'p_t', vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  const session = res.body.session;
  await client.request('session.prompt', { session, text: 'hi' });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && getSession(daemon.db, session)?.state !== 'idle')
    await new Promise(r => setTimeout(r, 25));
  assert.equal(getSession(daemon.db, session)?.state, 'idle');
  assert.ok(getSession(daemon.db, session)?.native_id, 'native id recorded');
  await daemon.close(); client.close();

  // Second daemon on the same store: the safe policy respawns the session and
  // journals 'resumed' once the reloaded worker reports ready.
  const daemon2 = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  const deadline2 = Date.now() + 15_000;
  while (Date.now() < deadline2 && !replay(daemon2.db, session).some(r => r.kind === 'resumed'))
    await new Promise(r => setTimeout(r, 25));
  assert.ok(replay(daemon2.db, session).some(r => r.kind === 'resumed'), 'resumed journaled');
  assert.equal(getSession(daemon2.db, session)?.state, 'idle');
  await daemon2.close();
  rmSync(dir, { recursive: true, force: true });
});

test('hello device identity drives ack cursors per device', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const { getCursor } = await import('@ormicode/journal');
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const hello = { v: 1, type: 'hello', role: 'client', proto: 1, device: 'd_testbox' };
  const client = await connect(daemon.socketPath, hello);
  const res = await client.request('session.start', { machine: newId('m'), project: 'p_t', vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  const session = res.body.session;
  await client.request('session.subscribe', { session });
  await client.request('session.prompt', { session, text: 'hi' });
  const deadline = Date.now() + 10_000;
  let seq = 0;
  while (Date.now() < deadline && !seq) {
    const frame = await client.next();
    if (frame?.type === 'evt' && frame.session === session && typeof frame.seq === 'number') seq = frame.seq;
  }
  assert.ok(seq > 0, 'got a journaled event');
  client.send({ v: 1, type: 'ack', session, seq });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(getCursor(daemon.db, 'd_testbox', session), seq, 'ack recorded under hello device');
  assert.equal(getCursor(daemon.db, 'cli', session), 0, 'not under the default device');
  await daemon.close(); client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('scratch sessions get a scratchpad cwd that session.delete removes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  process.env.ORMICODE_HOME = join(dir, 'home');
  try {
    const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
    const client = await connect(daemon.socketPath);
    const res = await client.request('session.start', { machine: newId('m'), project: 'scratch', vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'scratch' } });
    const session = res.body.session;
    const row = getSession(daemon.db, session);
    assert.ok(row?.cwd.startsWith(join(dir, 'home', 'scratch')), `cwd under scratchpad, got ${row?.cwd}`);
    const { existsSync } = await import('node:fs');
    assert.ok(existsSync(row.cwd), 'scratchpad created');
    await client.request('session.delete', { session });
    assert.equal(existsSync(row.cwd), false, 'delete removes the scratchpad');
    await daemon.close(); client.close();
  } finally {
    delete process.env.ORMICODE_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});
