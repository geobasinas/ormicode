import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designDocumentSchema, designOperationSchema } from '../src/index.ts';

const frame = { id: 'a', name: 'Phone', x: 0, y: 0, width: 390, height: 844, html: '', styles: '' };
const document = { version: 1, name: 'Legacy', revision: 1, frames: [frame], workingFrameId: null, comments: [] };

test('legacy v1 documents parse without layer fields', () => {
  assert.deepEqual(designDocumentSchema.parse(document), document);
});

test('frame layer fields parse and rotation is bounded', () => {
  const layered = { ...document, frames: [{ ...frame, rotation: 45, groupId: 'group1', locked: true, hidden: true }] };
  assert.deepEqual(designDocumentSchema.parse(layered), layered);
  assert.equal(designDocumentSchema.safeParse({ ...document, frames: [{ ...frame, rotation: 200 }] }).success, false);
});

test('batch schemas enforce group and order bounds and accept clearing a group', () => {
  assert.equal(designOperationSchema.safeParse({ type: 'frames.group', frameIds: ['a'] }).success, false);
  assert.equal(designOperationSchema.safeParse({ type: 'frames.order', frameIds: Array.from({ length: 25 }, (_, i) => `f${i}`) }).success, false);
  const operation = { type: 'frames.set', frames: [{ frameId: 'a', patch: { groupId: null } }] };
  assert.deepEqual(designOperationSchema.parse(operation), operation);
});
