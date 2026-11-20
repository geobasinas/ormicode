import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, hasPendingApproval, pendingQuestions } from '../src/index.ts';

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

test('pending questions distinguish late-answerable expiry from permanent closure and remain session-scoped', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  let seq = 0;
  const event = (session, kind, request, extra = {}) => db.prepare('INSERT INTO events(session, seq, kind, payload) VALUES (?, ?, ?, ?)')
    .run(session, ++seq, kind, JSON.stringify({ request, ...extra }));
  assert.deepEqual(pendingQuestions(db, 'child'), []);
  event('other', 'question_request', 'other');
  event('child', 'question_answer', 'daemon');
  event('child', 'question_request', 'daemon', { daemonInteraction: true });
  event('child', 'question_request', 'native');
  event('child', 'interaction_expired', 'daemon', { answerable: true });
  event('other', 'interaction_expired', 'native');
  assert.deepEqual(pendingQuestions(db, 'child'), ['daemon', 'native']);
  assert.deepEqual(pendingQuestions(db, 'child', { daemonOnly: true }), ['daemon']);
  event('child', 'interaction_expired', 'daemon', { answerable: false });
  event('child', 'question_answer', 'native');
  assert.deepEqual(pendingQuestions(db, 'child'), []);
  event('child', 'question_request', 'native');
  event('child', 'interaction_expired', 'native');
  assert.deepEqual(pendingQuestions(db, 'child'), []);
  assert.deepEqual(pendingQuestions(db, 'other'), ['other']);
});

test('pending approval queries can exclude handoffs without excluding native permissions', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const event = (seq, kind, payload) => db.prepare('INSERT INTO events(session, seq, kind, payload) VALUES (?, ?, ?, ?)')
    .run('child', seq, kind, JSON.stringify(payload));
  const options = { includeHandoffs: false };
  assert.equal(hasPendingApproval(db, 'child', options), false);
  event(1, 'approval_request', { request: 'handoff', approvalKind: 'handoff' });
  assert.equal(hasPendingApproval(db, 'child'), true);
  assert.equal(hasPendingApproval(db, 'child', options), false);
  event(2, 'approval_request', { request: 'native' });
  assert.equal(hasPendingApproval(db, 'child', options), true);
  event(3, 'approval_decision', { request: 'native' });
  assert.equal(hasPendingApproval(db, 'child', options), false);
  event(4, 'approval_request', { request: 'permission', approvalKind: 'permission' });
  assert.equal(hasPendingApproval(db, 'child', options), true);
  event(5, 'interaction_expired', { request: 'permission' });
  assert.equal(hasPendingApproval(db, 'child', options), false);
  assert.equal(hasPendingApproval(db, 'child'), true);
});
