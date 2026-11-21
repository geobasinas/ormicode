import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { replay } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); });

const boot = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-archive-test-')); dirs.push(dir);
  const projectDir = mkdtempSync(join(tmpdir(), 'ormi-archive-project-')); dirs.push(projectDir);
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  const startSession = async () => {
    const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
    assert.equal(res.type, 'res', JSON.stringify(res));
    return res.body.session;
  };
  return { daemon, client, startSession, cleanup: async () => { client.close(); await daemon.close(); } };
};

const waitReady = async (daemon, session) => {
  const deadline = Date.now() + 15_000;
  while (daemon.workers.get(session)?.ready !== true) {
    if (Date.now() > deadline) throw new Error('worker never ready');
    await new Promise(r => setTimeout(r, 25));
  }
};

test('session.archive hides the session, tells every client, and session.unarchive restores it', async () => {
  const { daemon, client, startSession, cleanup } = await boot();
  const other = await connect(daemon.socketPath);
  try {
    const session = await startSession();
    await waitReady(daemon, session);
    assert.equal((await other.request('session.list', {})).type, 'res');
    const idx = new Promise(resolve => { other.onFrame = frame => { if (frame.type === 'idx') resolve(frame); }; });
    assert.equal((await client.request('session.archive', { session })).body.archived, true);
    assert.ok((await idx).body.sessions.every(s => s.id !== session), 'an unsubscribed client gets a list refresh without the session');
    assert.ok(!(await client.request('session.list', {})).body.sessions.some(s => s.id === session));
    const archived = (await client.request('session.list', { archived: true })).body.sessions.find(s => s.id === session);
    assert.equal(archived?.state, 'archived');
    assert.equal(JSON.parse(replay(daemon.db, session).at(-1).payload).state, 'archived');

    const restoredIdx = new Promise(resolve => { other.onFrame = frame => { if (frame.type === 'idx') resolve(frame); }; });
    assert.equal((await client.request('session.unarchive', { session })).body.archived, false);
    assert.ok((await restoredIdx).body.sessions.some(s => s.id === session));
    const live = (await client.request('session.list', {})).body.sessions.find(s => s.id === session);
    assert.equal(live?.state, 'idle');
    assert.ok(!(await client.request('session.list', { archived: true })).body.sessions.some(s => s.id === session));
    assert.ok(daemon.db.prepare('SELECT 1 FROM leases WHERE session = ?').get(session), 'unarchive takes the workspace lease back');

    const again = await client.request('session.unarchive', { session });
    assert.deepEqual([again.type, again.code], ['err', 'session.not_archived']);
    const missing = await client.request('session.unarchive', { session: newId('s') });
    assert.deepEqual([missing.type, missing.code], ['err', 'session.not_found']);
  } finally { other.close(); await cleanup(); }
});

test('session.delete hides the session from the archived list while session.archive keeps it', async () => {
  const { client, startSession, cleanup } = await boot();
  try {
    const deleted = await startSession();
    assert.equal((await client.request('session.delete', { session: deleted })).body.deleted, true);
    assert.ok(!(await client.request('session.list', { archived: true })).body.sessions.some(s => s.id === deleted));
    assert.ok(!(await client.request('session.list', {})).body.sessions.some(s => s.id === deleted));

    const archived = await startSession();
    assert.equal((await client.request('session.archive', { session: archived })).body.archived, true);
    assert.ok((await client.request('session.list', { archived: true })).body.sessions.some(s => s.id === archived));
  } finally { await cleanup(); }
});

test('session.unarchive refuses a workspace another live session now holds', async () => {
  const { client, startSession, cleanup } = await boot();
  try {
    const session = await startSession();
    assert.equal((await client.request('session.archive', { session })).type, 'res');
    const replacement = await startSession();
    const res = await client.request('session.unarchive', { session });
    assert.deepEqual([res.type, res.code], ['err', 'lease.conflict']);
    assert.match(res.message, new RegExp(replacement));
    assert.ok((await client.request('session.list', { archived: true })).body.sessions.some(s => s.id === session));
  } finally { await cleanup(); }
});
