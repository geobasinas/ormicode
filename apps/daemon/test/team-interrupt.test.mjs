import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAdapter } from '@ormicode/agent-core';
import { openStore, createSession, setState } from '@ormicode/session-store';
import { interrupt } from '../src/team-interrupt.ts';

test('cancel succeeds when the adapter has finished but turn_end is still being pumped', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'child', machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
  const adapter = new FakeAdapter({ script: 'slow', delayMs: 0 });
  const handle = await adapter.start({ cwd: '/repo' }); t.after(() => adapter.dispose(handle));
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'finishing' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  setState(db, 'child', 'running');
  assert.equal((await stream.next()).value.kind, 'text_delta');
  assert.equal((await stream.next()).value.kind, 'text');
  let rejected = false;
  await interrupt({ db, teamApprovals: { waiting: () => false }, toWorker: async () => {
    try { await adapter.interrupt(handle); }
    catch (error) { rejected = true; assert.match(error.message, /no active turn/); }
    assert.equal((await stream.next()).value.kind, 'turn_end');
    setState(db, 'child', 'idle');
    return { type: 'err', code: 'agent.failed' };
  } }, 'child');
  assert.equal(rejected, true);
});

test('cancel is an idle no-op and still rejects an abort that leaves the child busy', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'child', machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
  const ctx = { db, teamApprovals: { waiting: () => false }, toWorker: async () => { assert.fail('idle children must not be interrupted'); } };
  await interrupt(ctx, 'child');
  setState(db, 'child', 'running');
  ctx.toWorker = async () => ({ type: 'err', code: 'agent.unsupported' });
  await assert.rejects(interrupt(ctx, 'child', 0), /could not be interrupted/);
  ctx.toWorker = async () => ({ type: 'res' });
  await assert.rejects(interrupt(ctx, 'child', 0), /did not finish interrupting/);
});

test('cancel interrupts an idle child with a delegated approval still pending', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'child', machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
  let waiting = true;
  let calls = 0;
  await interrupt({ db, teamApprovals: { waiting: () => waiting }, toWorker: async (session, method) => {
    assert.equal(session, 'child'); assert.equal(method, 'worker.abort');
    calls++; waiting = false;
    return { type: 'res' };
  } }, 'child');
  assert.equal(calls, 1);
});
