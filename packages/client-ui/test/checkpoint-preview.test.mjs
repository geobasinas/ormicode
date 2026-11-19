import assert from 'node:assert/strict';
import test from 'node:test';
import { checkpointPreview } from '../src/features/session/checkpoint-preview.ts';

test('attached tool checkpoints select their screenshot and the previous screenshot', () => {
  const checkpoint = { seq: 44, kind: 'checkpoint', body: { id: 'current' } };
  const events = [
    { seq: 20, kind: 'checkpoint_screenshot', body: { checkpoint: 'older', artifact: 'bl_old' } },
    checkpoint,
    { seq: 45, kind: 'checkpoint_screenshot', body: { checkpoint: 'current', artifact: 'bl_current' } },
  ];
  assert.deepEqual(checkpointPreview(events, checkpoint), {
    screenshot: 'bl_current',
    previous: { id: 'older', artifact: 'bl_old' },
  });
});
