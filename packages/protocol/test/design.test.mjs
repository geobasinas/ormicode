import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designDocumentSchema, designOperationSchema, designRequests, designResponses, newId } from '../src/index.ts';

const document = { version: 1, name: 'Home', revision: 1, frames: [], workingFrameId: null, comments: [] };
const frame = { id: 'frame1', name: 'Phone', x: 0, y: 0, width: 390, height: 844, html: '<p>Hello</p>', styles: '' };
const board = { session: newId('s'), slug: 'home' };

test('pages remain optional in v1 and page operations are strict and bounded', () => {
  assert.ok(designDocumentSchema.safeParse(document).success);
  assert.ok(designDocumentSchema.safeParse({ ...document, pages: [{ id: 'p', name: 'Page', background: '#abcdef', startFrameId: 'frame1', guides: [{ id: 'g', axis: 'x', at: -50 }] }], frames: [{ ...frame, pageId: 'p' }] }).success);
  const operations = [
    { type: 'page.add', name: 'New', background: '#123ABC' }, { type: 'page.rename', pageId: 'p', name: 'Renamed' },
    { type: 'page.move', pageId: 'p', index: 0 }, { type: 'page.duplicate', pageId: 'p' }, { type: 'page.remove', pageId: 'p' },
    { type: 'page.background', pageId: 'p', background: null }, { type: 'page.start', pageId: 'p', frameId: null },
    { type: 'guide.add', pageId: 'p', axis: 'y', at: 100000 }, { type: 'guide.move', pageId: 'p', guideId: 'g', at: 1 }, { type: 'guide.remove', pageId: 'p', guideId: 'g' },
  ];
  for (const operation of operations) assert.ok(designOperationSchema.safeParse(operation).success, operation.type);
  for (const background of ['red', '#fff', '#gggggg', '#12345678']) assert.equal(designOperationSchema.safeParse({ type: 'page.add', name: 'Bad', background }).success, false);
  assert.equal(designOperationSchema.safeParse({ type: 'page.move', pageId: 'p', index: -1 }).success, false);
  assert.equal(designOperationSchema.safeParse({ type: 'guide.add', pageId: 'p', axis: 'x', at: 100001 }).success, false);
});

test('design schemas bound UTF-8 document/request size, geometry and history', () => {
  assert.equal(designDocumentSchema.safeParse(document).success, true);
  assert.equal(designDocumentSchema.safeParse({ ...document, frames: [frame] }).success, true);
  assert.equal(designDocumentSchema.safeParse({ ...document, frames: [{ ...frame, width: Infinity }] }).success, false);
  assert.equal(designDocumentSchema.safeParse({ ...document, frames: [{ ...frame, height: 79 }] }).success, false);
  const largeFrames = Array.from({ length: 3 }, (_, index) => ({ ...frame, id: `frame${index}`, html: '🙂'.repeat(10000) }));
  assert.equal(designDocumentSchema.safeParse({ ...document, frames: largeFrames }).success, false);
  assert.equal(designRequests['design.get'].safeParse({ ...board, slug: '../outside' }).success, false);
  assert.equal(designRequests['design.update'].safeParse({ ...board, operations: [] }).success, false);
  assert.equal(designRequests['design.restore'].safeParse({ ...board, targetRevision: 1 }).success, false);
  const operation = { type: 'frame.add', name: 'Large', x: 0, y: 0, width: 100, height: 100, html: 'x'.repeat(24576), styles: '' };
  assert.equal(designRequests['design.update'].safeParse({ ...board, expectedRevision: 1, operations: Array.from({ length: 8 }, () => operation) }).success, false);
  const history = Array.from({ length: 21 }, (_, index) => ({ revision: index + 1, at: 0, summary: 'Update' }));
  assert.equal(designResponses['design.history'].safeParse({ history }).success, false);
  assert.equal(designResponses['design.get'].safeParse({ document, history }).success, false);
});
