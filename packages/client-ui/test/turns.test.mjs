import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptTurns, turnContents } from '../src/features/session/turns.ts';

const event = (seq, kind, body = {}) => ({ seq, kind, body, ts: seq * 1000 });
test('completed and interrupted turns retain their boundaries and stay separate from prompts', () => {
  const events = [event(1, 'prompt'), event(2, 'turn_start'), event(3, 'thinking'), event(4, 'tool_call'),
    event(5, 'text', { text: 'final' }), event(6, 'turn_end'), event(7, 'prompt'), event(8, 'turn_start'), event(9, 'interrupted', { reason: 'user_abort' })];
  const parts = transcriptTurns(events);
  assert.deepEqual(parts.map(p => p.kind), ['events', 'turn', 'events', 'turn']);
  assert.equal(parts[1].end.kind, 'turn_end');
  assert.equal(parts[3].end.kind, 'interrupted');
  assert.deepEqual(parts[1].events.map(e => e.seq), [3, 4, 5, 6]);
  assert.equal(parts[3].events[0].seq, 9);
});
test('all tool/thinking and nested rows are activity; final text and errors remain visible', () => {
  const events = [event(1, 'text', { text: 'checking' }), event(2, 'thinking_delta'), event(3, 'thinking'),
    event(4, 'tool_call'), event(5, 'text', { text: 'nested result', parent: 'tool' }), event(6, 'tool_result'),
    event(7, 'text_delta', { text: 'final' }), event(8, 'text', { text: 'final' }), event(9, 'error'), event(10, 'interrupted')];
  const { activity, visible } = turnContents(events);
  assert.deepEqual(activity.map(e => e.seq), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(visible.map(e => e.seq), [7, 8, 9, 10]);
  const delayed = turnContents([event(1, 'tool_call'), event(2, 'text', { text: 'final' }), event(3, 'checkpoint'), event(4, 'tool_result')]);
  assert.deepEqual(delayed.visible.map(e => e.seq), [2]);
});
test('running, empty, text-only and incomplete historical turns have safe boundaries', () => {
  assert.deepEqual(transcriptTurns([]), []);
  assert.deepEqual(turnContents([]), { activity: [], visible: [] });
  const running = transcriptTurns([event(1, 'turn_start'), event(2, 'tool_call')])[0];
  assert.equal(running.end, undefined);
  assert.deepEqual(turnContents([event(1, 'text')]).activity, []);
  const interruptedHistory = transcriptTurns([event(1, 'turn_start'), event(2, 'tool_call'), event(3, 'prompt'), event(4, 'turn_start')]);
  assert.equal(interruptedHistory[0].end.seq, 3);
  assert.equal(interruptedHistory[2].end, undefined);
});
