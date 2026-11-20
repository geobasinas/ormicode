import test from 'node:test';
import assert from 'node:assert/strict';
import { activeTurnStart } from '../src/features/session/turn-liveness.ts';
import { transcriptTurns } from '../src/features/session/turns.ts';

const event = (seq, kind, body = {}) => ({ seq, kind, body, ts: seq * 1000 });
const open = [event(1, 'turn_start'), event(2, 'tool_call')];

test('only an active session can animate its latest unclosed turn', () => {
  assert.equal(activeTurnStart([], { state: 'running', lastSeq: 0 }), undefined);
  assert.equal(activeTurnStart(open), undefined);
  for (const state of ['idle', 'done', 'interrupted', 'failed', 'archived', 'paused_rate_limited'])
    assert.equal(activeTurnStart(open, { state, lastSeq: 2 }), undefined);
  for (const state of ['running', 'starting', 'retrying', 'awaiting_approval', 'awaiting_input'])
    assert.equal(activeTurnStart(open, { state, lastSeq: 2 }), 1);
  const next = [...open, event(3, 'turn_start'), event(4, 'tool_call')];
  assert.equal(activeTurnStart(next, { state: 'running', lastSeq: 4 }), 3);
});

test('new journal state overrides a lagging session snapshot, not a current terminal snapshot', () => {
  assert.equal(activeTurnStart(open, { state: 'idle', lastSeq: 0 }), 1);
  assert.equal(activeTurnStart(open, { state: 'idle', lastSeq: 2 }), undefined);
  assert.equal(activeTurnStart(open, { state: 'idle' }), undefined);
  for (const state of ['idle', 'failed', 'interrupted'])
    assert.equal(activeTurnStart([...open, event(3, 'state', { state })], { state: 'running', lastSeq: 1 }), undefined);
});

test('full journal endings and rewind barriers cannot be hidden into a live historical turn', () => {
  const closed = [...open, event(3, 'checkpoint'), event(4, 'turn_end')];
  const rewound = [...closed, event(5, 'conversation_rewound', { to: 3 })];
  assert.equal(activeTurnStart(rewound, { state: 'running', lastSeq: 1 }), undefined);
  const visible = rewound.filter(e => e.seq <= 3 || e.seq >= 5);
  const [retained] = transcriptTurns(visible);
  assert.equal(retained.end, undefined);
  assert.equal(retained.events.at(-1).ts - retained.start.ts, 2000);
  assert.equal(activeTurnStart([...rewound, event(6, 'turn_start')], { state: 'idle', lastSeq: 5 }), 6);
  assert.equal(activeTurnStart([...open, event(3, 'interrupted')], { state: 'running', lastSeq: 1 }), undefined);
});
