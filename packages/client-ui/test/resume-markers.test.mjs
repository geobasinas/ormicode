import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseResumeMarkers } from '../src/features/session/resume-markers.ts';

test('collapses old consecutive resume markers but preserves intervening activity', () => {
  const events = ['text', 'resumed', 'resumed', 'resumed', 'prompt', 'resumed'].map(kind => ({ kind }));
  assert.deepEqual(collapseResumeMarkers(events).map(e => e.kind), ['text', 'resumed', 'prompt', 'resumed']);
  assert.deepEqual(collapseResumeMarkers([]), []);
  assert.deepEqual(collapseResumeMarkers([{ kind: 'error' }, { kind: 'resumed' }]), [{ kind: 'error' }, { kind: 'resumed' }]);
});
