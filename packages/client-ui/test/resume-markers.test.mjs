import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseResumeMarkers } from '../src/features/session/resume-markers.ts';

test('collapses old consecutive resume markers but preserves intervening activity', () => {
  const events = ['text', 'resumed', 'resumed', 'resumed', 'prompt', 'resumed'].map(kind => ({ kind }));
  assert.deepEqual(collapseResumeMarkers(events).map(e => e.kind), ['text', 'resumed', 'prompt', 'resumed']);
  assert.deepEqual(collapseResumeMarkers([]), []);
  assert.deepEqual(collapseResumeMarkers([{ kind: 'error' }, { kind: 'resumed' }]), [{ kind: 'error' }, { kind: 'resumed' }]);
});

test('collapses resume markers separated only by events the transcript hides', () => {
  const hidden = ['evicted', 'usage', 'state', 'agent_version', 'turn_start', 'turn_end'];
  const events = [{ kind: 'text' }];
  for (let i = 0; i < 12; i++) events.push({ kind: hidden[i % hidden.length] }, { kind: 'resumed' });
  const kept = collapseResumeMarkers(events);
  assert.equal(kept.filter(e => e.kind === 'resumed').length, 1);
  assert.equal(kept.length, events.length - 11);
  const withActivity = ['resumed', 'evicted', 'resumed', 'usage', 'prompt', 'usage', 'resumed', 'interrupted', 'evicted', 'resumed'].map(kind => ({ kind }));
  assert.deepEqual(collapseResumeMarkers(withActivity).map(e => e.kind), ['resumed', 'evicted', 'usage', 'prompt', 'usage', 'resumed', 'interrupted', 'evicted', 'resumed']);
});
