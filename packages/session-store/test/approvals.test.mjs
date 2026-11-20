import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, hasPendingApproval } from '../src/index.ts';

test('pending user approvals are session-scoped and closed only by a later matching decision or expiry', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  let seq = 0;
  const event = (session, kind, request) => db.prepare('INSERT INTO events(session, seq, kind, payload) VALUES (?, ?, ?, ?)')
    .run(session, ++seq, kind, JSON.stringify({ request }));
  assert.equal(hasPendingApproval(db, 'child'), false);
  event('other', 'approval_request', 'request');
  event('child', 'team_approval_request', 'delegated');
  event('child', 'question_request', 'question');
  assert.equal(hasPendingApproval(db, 'child'), false);
  event('child', 'approval_decision', 'request');
  event('child', 'approval_request', 'request');
  assert.equal(hasPendingApproval(db, 'child'), true);
  event('other', 'approval_decision', 'request');
  event('child', 'interaction_expired', 'unrelated');
  assert.equal(hasPendingApproval(db, 'child'), true);
  event('child', 'approval_decision', 'request');
  assert.equal(hasPendingApproval(db, 'child'), false);
  event('child', 'approval_request', 'request');
  assert.equal(hasPendingApproval(db, 'child'), true);
  event('child', 'interaction_expired', 'request');
  assert.equal(hasPendingApproval(db, 'child'), false);
  assert.equal(hasPendingApproval(db, 'other'), false);
});
