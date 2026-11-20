import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingInteractions } from '../src/features/session/pending-interactions.ts';

test('expired daemon questions remain answerable on live and replayed transcripts until answered', () => {
  const question = { kind: 'question_request', body: { request: 'q', daemonInteraction: true } };
  const expired = { kind: 'interaction_expired', body: { request: 'q', answerable: true } };
  const events = [question, expired, { kind: 'state', body: { state: 'idle' } }];
  assert.deepEqual(events.reduce(pendingInteractions, []), [question]);
  assert.deepEqual(pendingInteractions([question], { kind: 'question_answer', body: { request: 'q' } }), []);
  assert.deepEqual(pendingInteractions([question], { ...expired, body: { request: 'q' } }), []);
  assert.deepEqual(pendingInteractions([], expired), []);
  const approval = { kind: 'approval_request', body: { request: 'a' } };
  assert.deepEqual(pendingInteractions([question, approval], { kind: 'interaction_expired', body: { request: 'a', answerable: true } }), [question]);
  assert.deepEqual(pendingInteractions([question, approval], { kind: 'approval_decision', body: { request: 'a' } }), [question]);
  const updated = { ...question, body: { ...question.body, questions: [] } };
  assert.deepEqual(pendingInteractions([question], updated), [updated]);
});
