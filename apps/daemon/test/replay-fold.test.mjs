import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold } from '../src/replay-methods.ts';

const ev = (seq, kind, payload = {}, ts = seq * 1000) => ({ seq, ts, kind, payload });

test('fold rebuilds session state at any seq', () => {
  const events = [
    ev(1, 'prompt', { text: 'go' }),
    ev(2, 'turn_start'),
    ev(3, 'model_changed', { model: 'claude-4' }),
    ev(4, 'tool_call', { callId: 'c1', name: 'Edit', input: { file_path: 'a.ts' } }),
    ev(5, 'approval_request', { request: 'r1', tool: 'Bash', input: { command: 'rm x' } }),
    ev(6, 'text', { text: 'done' }),
    ev(7, 'usage', { input: 10, output: 5 }),
    ev(8, 'turn_end'),
    ev(9, 'text', { text: 'later' }),
  ];
  const mid = fold(events, 5);
  assert.equal(mid.seq, 5);
  assert.equal(mid.state, 'awaiting_approval');
  assert.equal(mid.model, 'claude-4');
  assert.equal(mid.running.length, 1);
  assert.equal(mid.running[0].name, 'Edit');
  assert.equal(mid.pending.length, 1);
  assert.equal(mid.pending[0].kind, 'approval');
  assert.equal(mid.tokens, 0, 'usage at seq 7 is after the cut');
  const end = fold(events, 8);
  assert.equal(end.state, 'idle');
  assert.equal(end.tokens, 15);
});

test('pending interactions close on decision, answer or expiry', () => {
  const events = [
    ev(1, 'approval_request', { request: 'a', tool: 'Bash' }),
    ev(2, 'question_request', { request: 'q' }),
    ev(3, 'approval_decision', { request: 'a' }),
    ev(4, 'interaction_expired', { request: 'q' }),
  ];
  assert.equal(fold(events, 4).pending.length, 0);
  const half = fold(events, 2);
  assert.deepEqual(half.pending.map(p => p.request), ['a', 'q']);
});

test('a stored base frame folds forward without replaying old events', () => {
  const base = { seq: 3, state: 'running', model: 'm1', pending: [], running: [], tokens: 100 };
  const events = [ev(4, 'usage', { input: 5, output: 5 }), ev(5, 'turn_end'), ev(6, 'text', { text: 'x' })];
  const frame = fold(events, 5, base);
  assert.equal(frame.tokens, 110);
  assert.equal(frame.state, 'idle');
  assert.equal(frame.model, 'm1');
  // Events before the base are not double-counted.
  const same = fold(events, 5, base);
  assert.equal(same.tokens, 110);
});
