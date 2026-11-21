import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';
import { getSession } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';

const events = (db, session, kind) => replay(db, session).filter(e => e.kind === kind).map(e => JSON.parse(e.payload));
const eventually = async fn => {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('timed out');
};

// The fake `approval` script, like the Codex SDK, throws if prompted while a turn waits for workspace access.
test('a follow-up prompt during a pending approval is busy, queues, and runs after Allow', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-await-approval-'));
  const previous = process.env.ORMICODE_FAKE_SCRIPT;
  process.env.ORMICODE_FAKE_SCRIPT = 'approval';
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  t.after(async () => {
    client.close(); await daemon.close();
    if (previous === undefined) delete process.env.ORMICODE_FAKE_SCRIPT; else process.env.ORMICODE_FAKE_SCRIPT = previous;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  });
  const session = (await client.request('session.start', { machine: newId('m'), project: dir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } })).body.session;
  assert.equal((await client.request('session.prompt', { session, text: 'write the file' })).type, 'res');
  await eventually(() => getSession(daemon.db, session).state === 'awaiting_approval');

  const busy = await client.request('session.prompt', { session, text: 'and then this' });
  assert.equal(busy.type, 'err');
  assert.equal(busy.code, 'session.busy');
  assert.match(busy.message, /approval/);
  assert.equal(getSession(daemon.db, session).state, 'awaiting_approval');
  assert.equal(events(daemon.db, session, 'approval_request').length, 1);

  assert.equal((await client.request('session.queue.add', { session, text: 'and then this' })).type, 'res');
  const [request] = events(daemon.db, session, 'approval_request');
  assert.equal((await client.request('session.decide', { session, request: request.request, option: 'allow' })).body.decided, true);
  await eventually(() => events(daemon.db, session, 'approval_request').length === 2);
  assert.equal(events(daemon.db, session, 'tool_result')[0].status, 'completed');
  assert.equal(events(daemon.db, session, 'turn_end').length, 1);
  assert.deepEqual(events(daemon.db, session, 'prompt').map(p => p.text), ['write the file', 'and then this']);
  assert.equal((await client.request('session.queue.list', { session })).body.items.length, 0);
  const second = events(daemon.db, session, 'approval_request')[1];
  await client.request('session.decide', { session, request: second.request, option: 'deny' });
});
