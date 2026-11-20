import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptToolResults } from '../src/features/session/tool-results.ts';

const event = (seq, kind, body = {}) => ({ seq, kind, body });
test('historical interrupted turns close open and nested tools without changing completed or failed rows', () => {
  const events = [event(1, 'tool_call', { callId: 'ok' }), event(2, 'tool_result', { callId: 'ok', status: 'completed' }),
    event(3, 'tool_call', { callId: 'bad' }), event(4, 'tool_result', { callId: 'bad', status: 'failed' }),
    event(5, 'tool_call', { callId: 'parent' }), event(6, 'tool_call', { callId: 'child', parent: 'parent' }),
    event(7, 'interrupted', { reason: 'user_abort' }), event(8, 'tool_call', { callId: 'next-turn' })];
  const results = transcriptToolResults(events);
  assert.equal(results.get('ok').body.status, 'completed');
  assert.equal(results.get('bad').body.status, 'failed');
  assert.equal(results.get('parent').body.status, 'interrupted');
  assert.equal(results.get('child').body.status, 'interrupted');
  assert.equal(results.get('child').body.parent, 'parent');
  assert.equal(results.has('next-turn'), false);
});
test('current-turn calls never inherit earlier results or interrupted open calls', () => {
  const first = [event(1, 'turn_start'), event(2, 'tool_call', { callId: 'call-1' }),
    event(3, 'tool_result', { callId: 'call-1', status: 'completed' }), event(4, 'tool_call', { callId: 'old' }), event(5, 'turn_end')];
  const second = [event(6, 'turn_start'), event(7, 'tool_call', { callId: 'call-1' })];
  assert.equal(transcriptToolResults(first).get('call-1').body.status, 'completed');
  assert.equal(transcriptToolResults([...first, ...second]).has('call-1'), false);
  const results = transcriptToolResults([...first, ...second, event(8, 'interrupted')]);
  assert.equal(results.get('call-1').body.status, 'interrupted');
  assert.equal(results.has('old'), false);
  assert.equal(transcriptToolResults(first).get('call-1').body.status, 'completed');
});
test('empty and still-running transcripts do not synthesize results', () => {
  assert.equal(transcriptToolResults([]).size, 0);
  assert.equal(transcriptToolResults([event(1, 'tool_call', { callId: 'running' })]).size, 0);
});
