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
const projectDir = mkdtempSync(join(tmpdir(), 'ormi-daemon-project-'));
test.after(() => rmSync(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}));

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
  const started = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
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
  const started = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
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
    const started = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
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
  assert.equal(status.body.proto, 1);
  assert.equal(typeof status.body.uptimeMs, 'number');
  const agents = await client.request('agents.list', {});
  assert.deepEqual(agents.body.agents.find(a => a.vendor === 'claude')?.transports, ['sdk', 'cli']);
  assert.ok(agents.body.agents.some(a => a.vendor === 'fake'));
  const bogus = await client.request('bogus.method', {});
  assert.equal(bogus.type, 'err');
  await daemon.close();
});

test('a completed session auto-resumes on daemon restart under the safe policy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const storePath = join(dir, 'store.db');
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  const client = await connect(daemon.socketPath);
  const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
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
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
});

test('a non-resumable session under the all policy gets a recap injected as context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const storePath = join(dir, 'store.db');
  // fake/sdk is not in the resumable set, so 'all' recovery respawns it recap-only.
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  const client = await connect(daemon.socketPath);
  const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'sdk', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  const session = res.body.session;
  await client.request('session.prompt', { session, text: 'hi' });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && getSession(daemon.db, session)?.state !== 'idle')
    await new Promise(r => setTimeout(r, 25));
  assert.equal(getSession(daemon.db, session)?.state, 'idle');
  await daemon.close(); client.close();

  process.env.ORMICODE_RESUME_POLICY = 'all';
  const daemon2 = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  delete process.env.ORMICODE_RESUME_POLICY;
  try {
    const deadline2 = Date.now() + 15_000;
    const journal = () => replay(daemon2.db, session).map(r => ({ kind: r.kind, text: JSON.parse(r.payload).text }));
    const recapDone = () => { const rows = journal(); const i = rows.findIndex(r => r.kind === 'handoff_brief'); return i >= 0 && rows.slice(i + 1).some(r => r.kind === 'turn_end'); };
    while (Date.now() < deadline2 && !recapDone())
      await new Promise(r => setTimeout(r, 25));
    const rows = journal();
    const briefIdx = rows.findIndex(r => r.kind === 'handoff_brief');
    assert.ok(briefIdx >= 0, 'handoff_brief journaled');
    assert.match(rows[briefIdx].text, /^Goal: hi$/m);
    assert.match(rows[briefIdx].text, /^Next step:/m);
    assert.doesNotMatch(rows[briefIdx].text, /None recorded/);
    assert.ok(rows[briefIdx].text.includes('Goal: hi'), 'brief preserves the original goal');
    const after = rows.slice(briefIdx + 1);
    assert.ok(after.some(r => r.kind === 'turn_end'), 'recap prompt completed a turn');
    assert.ok(after.some(r => r.kind === 'text' && String(r.text).includes('Context recap')), 'recap text reached the agent');
  } finally {
    await daemon2.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('hello device identity drives ack cursors per device', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const { getCursor } = await import('@ormicode/journal');
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const hello = { v: 1, type: 'hello', role: 'client', proto: 1, device: 'd_testbox' };
  const client = await connect(daemon.socketPath, hello);
  const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
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
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
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
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('reconnect with a cursor replays only newer events, no gaps or dupes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
  const session = res.body.session;
  await client.request('session.subscribe', { session });
  await client.request('session.prompt', { session, text: 'hi' });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && getSession(daemon.db, session)?.state !== 'idle')
    await new Promise(r => setTimeout(r, 25));
  const rows = replay(daemon.db, session);
  const cut = rows[rows.length - 2].seq; // seen all but the last durable event
  client.close();

  // Reconnect and resync from the cursor: only seq > cut arrives, in order.
  const client2 = await connect(daemon.socketPath);
  await client2.request('session.subscribe', { session, after: cut });
  const deadline2 = Date.now() + 5_000;
  const seen = [];
  while (Date.now() < deadline2 && seen.length < rows.length - cut) {
    const frame = await client2.next();
    if (frame?.type === 'evt' && frame.session === session) seen.push(frame.seq);
  }
  assert.deepEqual(seen, rows.map(r => r.seq).filter(s => s > cut), 'gapless tail from the cursor');
  // A cursor at the tail replays nothing.
  const client3 = await connect(daemon.socketPath);
  const sub = await client3.request('session.subscribe', { session, after: rows.at(-1).seq });
  assert.equal(sub.type, 'res');
  assert.equal(await Promise.race([client3.next(), new Promise(r => setTimeout(() => r('quiet'), 400))]), 'quiet');
  await daemon.close(); client2.close(); client3.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
});

test("session.start treats 'default' placeholders as unset", async () => {
  const { daemon, client } = await boot();
  const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'default', effort: 'default', mode: 'default', workspace: { kind: 'current' } });
  const row = getSession(daemon.db, res.body.session);
  assert.equal(row.model, null);
  assert.equal(row.effort, null);
  assert.equal(row.mode, null);
  await daemon.close(); client.close();
});

test('pair.create + pair.join mint a device token; revoke needs the name', async () => {
  const { daemon, client } = await boot();
  const created = await client.request('pair.create', {});
  assert.equal(created.type, 'res');
  const { code, expiresAt, link } = created.body;
  assert.match(code, /^\d{4} \d{4} \d{4}$/);
  assert.ok(expiresAt > Date.now());
  assert.ok(link.startsWith('ormi://pair?c='));

  const joined = await client.request('pair.join', { code, name: 'test phone' });
  assert.equal(joined.type, 'res');
  assert.match(joined.body.device, /^d_/);
  assert.equal(joined.body.token.length > 30, true);

  // The code is burned after one use.
  const again = await client.request('pair.join', { code, name: 'second' });
  assert.equal(again.type, 'err');

  const list = await client.request('devices.list', {});
  assert.equal(list.body.devices.length, 1);
  assert.equal(list.body.devices[0].name, 'test phone');

  const badConfirm = await client.request('devices.revoke', { device: joined.body.device, confirm: 'wrong name' });
  assert.equal(badConfirm.type, 'err');
  assert.equal(badConfirm.code, 'devices.confirm_mismatch');

  const revoked = await client.request('devices.revoke', { device: joined.body.device, confirm: 'test phone' });
  assert.equal(revoked.type, 'res');
  assert.equal(revoked.body.revoked, true);

  const empty = await client.request('devices.list', {});
  assert.equal(empty.body.devices.length, 0);
  await daemon.close();
});

test('pair.join rejects malformed and unknown codes', async () => {
  const { daemon, client } = await boot();
  const bad = await client.request('pair.join', { code: 'not a code', name: 'x' });
  assert.equal(bad.type, 'err');
  assert.equal(bad.code, 'pairing.invalid_code');
  const unknown = await client.request('pair.join', { code: '1234 5678 9012', name: 'x' });
  assert.equal(unknown.type, 'err');
  await daemon.close();
});
