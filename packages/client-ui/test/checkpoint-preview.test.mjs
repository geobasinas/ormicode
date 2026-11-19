import assert from 'node:assert/strict';
import test from 'node:test';
import { checkpointPreview, checkpointScreenshots, samePixelBytes } from '../src/features/session/checkpoint-preview.ts';

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

test('checkpoint choices include only screenshots and use time, tool or prompt, and short id', () => {
  const ts = Date.UTC(2025, 0, 1, 13, 5);
  const events = [
    { seq: 1, kind: 'prompt', body: { text: 'Fix header spacing' }, ts },
    { seq: 2, kind: 'checkpoint', body: { id: 'baseline-id', tool: 'baseline' }, ts },
    { seq: 3, kind: 'checkpoint_screenshot', body: { checkpoint: 'baseline-id', artifact: 'bl_first' }, ts },
    { seq: 4, kind: 'checkpoint', body: { id: 'abcdef123456', tool: 'apply_patch' }, ts },
    { seq: 5, kind: 'checkpoint_screenshot', body: { checkpoint: 'abcdef123456', artifact: 'bl_second' }, ts },
    { seq: 6, kind: 'checkpoint', body: { id: 'no-image', tool: 'edit' }, ts },
  ];
  const choices = checkpointScreenshots(events);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].artifact, 'bl_first');
  assert.equal(choices[0].label.split(' · ')[1], 'Fix header spacing');
  assert.equal(choices[1].label.split(' · ')[1], 'apply_patch');
  assert.match(choices[1].label, /abcdef1/);
});

test('pixel row comparison detects equal and differing pixels', () => {
  assert.equal(samePixelBytes(Uint8Array.from([0, 64, 128]), Uint8Array.from([0, 64, 128])), true);
  assert.equal(samePixelBytes(Uint8Array.from([0, 64, 128]), Uint8Array.from([0, 64, 129])), false);
  assert.equal(samePixelBytes(Uint8Array.from([0]), Uint8Array.from([0, 1])), false);
});
