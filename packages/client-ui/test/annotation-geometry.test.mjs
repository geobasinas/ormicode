import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationEditorPosition, annotationLabelCenterY, annotationLabelLeft } from '../src/features/browser/annotation-geometry.ts';

test('keeps box labels above the marked area when there is room', () => {
  const center = annotationLabelCenterY(40, 80, 22, 4, 10, 100);
  assert.equal(center, 25);
  assert.ok(center + 11 + 4 <= 40);
});

test('puts box labels below when they would run off the top and clamps to the frame', () => {
  const center = annotationLabelCenterY(4, 30, 22, 4, 10, 100);
  assert.equal(center, 45);
  assert.ok(center - 11 >= 30 + 4);
  assert.equal(annotationLabelCenterY(4, 90, 22, 4, 10, 100), 89);
});

test('clamps comment labels using their measured width', () => {
  assert.equal(annotationLabelLeft(20, 40, 100), 20);
  assert.equal(annotationLabelLeft(-10, 40, 100), 1);
  assert.equal(annotationLabelLeft(90, 40, 100), 59);
});

test('positions the comment editor below-left of its pin and flips above at the bottom edge', () => {
  assert.deepEqual(annotationEditorPosition(250, 100, 400, 300, 210, 110), { left: 28, top: 112 });
  assert.deepEqual(annotationEditorPosition(390, 260, 400, 300, 210, 110), { left: 168, top: 138 });
});
