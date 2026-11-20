import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, setState, getSession, sessionActivityState } from '../src/index.ts';

function fixture(t) {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'child', machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  let seq = 0;
  const event = (kind, payload = {}) => db.prepare('INSERT INTO events(session, seq, kind, payload) VALUES (?, ?, ?, ?)')
    .run('child', ++seq, kind, JSON.stringify(payload));
  return { db, event };
}

test('current non-approval states take precedence over stale journal activity, preserving failure reasons', t => {
  const { db, event } = fixture(t);
  assert.equal(sessionActivityState(db, 'missing'), 'idle');
  event('turn_start'); event('rate_limited');
  for (const state of ['idle', 'starting', 'running', 'retrying', 'awaiting_input', 'paused_rate_limited', 'interrupted', 'failed', 'done', 'archived']) {
    setState(db, 'child', state, 'resume_failed');
    assert.equal(sessionActivityState(db, 'child'), state);
    assert.equal(getSession(db, 'child').reason, 'resume_failed');
  }
});

test('approval overlays reveal rate-limit pauses only for errors that actually establish a pause', t => {
  const { db, event } = fixture(t);
  setState(db, 'child', 'awaiting_approval');
  assert.equal(sessionActivityState(db, 'child'), 'idle');
  event('turn_start'); event('rate_limited');
  for (const payload of [{ code: 'rate_limited' }, { code: 'rate_limited', resetAt: '123' }, { code: 'other', resetAt: 123 }]) {
    event('error', payload);
    assert.equal(sessionActivityState(db, 'child'), 'retrying');
  }
  for (const code of ['rate_limited', 'plan_limit']) {
    event('error', { code, resetAt: 123 });
    event('approval_request', { request: code, approvalKind: 'handoff' });
    event('error', { code: 'unrelated' });
    assert.equal(sessionActivityState(db, 'child'), 'paused_rate_limited');
  }
  event('turn_start'); assert.equal(sessionActivityState(db, 'child'), 'running');
  event('interrupted', { reason: 'resume_failed' }); assert.equal(sessionActivityState(db, 'child'), 'interrupted');
  event('turn_end'); assert.equal(sessionActivityState(db, 'child'), 'idle');
});
