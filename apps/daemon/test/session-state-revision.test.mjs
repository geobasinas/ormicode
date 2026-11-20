import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, setState } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';
import { onClientFrame } from '../src/dispatch.ts';

test('session.get identifies the journal revision covered by its state snapshot', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const session = newId('s');
  createSession(db, { id: session, machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  const ctx = { db, teamApprovals: { waiting: () => false, forParent: () => [] }, teamLifecycle: { state: row => row.state } };
  let result;
  const client = { device: 'desktop', link: { reply: (_id, body) => { result = body; }, replyError: (_id, code) => { result = { code }; } } };
  const get = () => onClientFrame(ctx, client, { v: 1, type: 'req', id: 'state', method: 'session.get', body: { session } });
  await get();
  assert.equal(result.state, 'idle'); assert.equal(result.lastSeq, 0);
  const { seq } = append(db, session, { kind: 'turn_start', payload: {} });
  setState(db, session, 'running');
  await get();
  assert.equal(result.state, 'running'); assert.equal(result.lastSeq, seq);
  await onClientFrame(ctx, client, { v: 1, type: 'req', id: 'missing', method: 'session.get', body: { session: newId('s') } });
  assert.equal(result.code, 'session.not_found');
});
