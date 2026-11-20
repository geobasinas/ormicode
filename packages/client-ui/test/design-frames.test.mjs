import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designRequests, newId } from '@ormicode/protocol';
import { clickSelection, reconcileSelection, marqueeHits, rotatedBounds, moveFrames, scaleFrames, rotateFrames, changedPatches } from '../src/features/design/frames/frame-selection.ts';
import { serializeFrames, parseFrameClip, pasteOperation, duplicateOperation, droppedFrame } from '../src/features/design/frames/frame-clipboard.ts';
import { diffDocuments, historyOperations, pushEntry, HISTORY_BYTES } from '../src/features/design/frames/frame-history.ts';
import { applyFrameOperation } from '../../../apps/daemon/src/design-frame-ops.ts';

const frame = (id, fields = {}) => ({ id, name: id, x: 0, y: 0, width: 100, height: 100, html: '<p>Hello</p>', styles: '', ...fields });
const document = (frames = []) => ({ version: 1, name: 'Board', revision: 1, frames, comments: [], workingFrameId: null });
const note = (id, frameId) => ({ id, frameId, text: 'Feedback', resolved: false, session: newId('s'), createdAt: 1 });
const identity = value => value;

test('click selection replaces or extends selection and toggles whole groups', () => {
  const frames = [frame('a', { groupId: 'g' }), frame('b', { groupId: 'g' }), frame('c')];
  assert.deepEqual(clickSelection(frames, { primary: 'c', extra: [] }, 'a', false), { primary: 'a', extra: ['b'] });
  assert.deepEqual(clickSelection(frames, { primary: '', extra: [] }, 'c', false), { primary: 'c', extra: [] });
  assert.deepEqual(clickSelection(frames, { primary: 'c', extra: [] }, 'a', true), { primary: 'c', extra: ['a', 'b'] });
  assert.deepEqual(clickSelection(frames, { primary: 'a', extra: ['b', 'c'] }, 'b', true), { primary: 'c', extra: [] });
  assert.deepEqual(clickSelection(frames, { primary: 'c', extra: ['a', 'b'] }, 'c', true), { primary: 'a', extra: ['b'] });
  assert.deepEqual(clickSelection(frames, { primary: '', extra: [] }, 'b', true), { primary: 'b', extra: ['a'] });
});

test('reconcileSelection drops missing and hidden IDs including the primary', () => {
  const frames = [frame('a'), frame('b', { hidden: true }), frame('c', { locked: true })];
  assert.deepEqual(reconcileSelection(frames, { primary: 'a', extra: ['a', 'b', 'missing', 'c', 'c'] }), { primary: 'a', extra: ['c'] });
  assert.deepEqual(reconcileSelection(frames, { primary: 'b', extra: ['missing', 'c', 'a'] }), { primary: 'c', extra: ['a'] });
  assert.deepEqual(reconcileSelection(frames, { primary: 'missing', extra: [] }), { primary: '', extra: [] });
  assert.deepEqual(reconcileSelection([], { primary: 'a', extra: ['c'] }), { primary: '', extra: [] });
});

test('marquee ignores locked and hidden frames and expands visible editable group members', () => {
  const frames = [frame('a', { groupId: 'g' }), frame('b', { x: 500, groupId: 'g' }), frame('locked', { locked: true, groupId: 'g' }), frame('hidden', { hidden: true, groupId: 'g' }), frame('outside', { x: 500 })];
  assert.deepEqual(marqueeHits(frames, { x: 10, y: 10, width: 20, height: 20 }), ['a', 'b']);
  assert.deepEqual(marqueeHits(frames, { x: -100, y: -100, width: 10, height: 10 }), []);
  assert.deepEqual(marqueeHits([], { x: 0, y: 0, width: 100, height: 100 }), []);
});

test('rotated bounds, clamped moves and proportional scales preserve geometry constraints', () => {
  const bounds = rotatedBounds(frame('a', { x: 10, y: 20, width: 200, height: 100, rotation: 90 }));
  for (const [key, expected] of Object.entries({ x: 60, y: -30, width: 100, height: 200 })) assert.ok(Math.abs(bounds[key] - expected) < 1e-9);
  assert.deepEqual(moveFrames([frame('a', { x: 99990, y: -99990 })], 50, -50), [{ frameId: 'a', patch: { x: 100000, y: -100000 } }]);
  const frames = [frame('a'), frame('b', { x: 200, y: 100, width: 200, height: 100 })];
  assert.deepEqual(scaleFrames(frames, { x: 0, y: 0, width: 400, height: 200 }, { x: 10, y: 20, width: 800, height: 400 }), [
    { frameId: 'a', patch: { x: 10, y: 20, width: 200, height: 200 } },
    { frameId: 'b', patch: { x: 410, y: 220, width: 400, height: 200 } },
  ]);
  assert.deepEqual(scaleFrames([frame('a')], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 1, height: 1 })[0].patch, { x: 0, y: 0, width: 80, height: 80 });
  assert.deepEqual(moveFrames([], 10, 10), []);
  assert.deepEqual(scaleFrames([], bounds, bounds), []);
});

test('rotation turns frame centers about the union center and normalizes angles', () => {
  const frames = [frame('a', { rotation: 180 }), frame('b', { x: 200, rotation: 90 })];
  assert.deepEqual(rotateFrames(frames, { x: 150, y: 50 }, 90), [
    { frameId: 'a', patch: { x: 100, y: -100, rotation: -90 } },
    { frameId: 'b', patch: { x: 100, y: 100, rotation: 180 } },
  ]);
  assert.equal(rotateFrames([frame('a', { rotation: -90 })], { x: 50, y: 50 }, -90)[0].patch.rotation, 180);
  assert.deepEqual(rotateFrames([], { x: 0, y: 0 }, 90), []);
});

test('changedPatches removes no-ops and patches for missing frames', () => {
  const changed = { frameId: 'a', patch: { x: 1 } };
  assert.deepEqual(changedPatches([frame('a')], [{ frameId: 'a', patch: { x: 0, rotation: 0 } }, { frameId: 'a', patch: {} }, { frameId: 'missing', patch: { x: 1 } }, changed]), [changed]);
  assert.deepEqual(changedPatches([], []), []);
});

test('clipboard roundtrip preserves relative layout, rotation and groups and sanitizes HTML', () => {
  const frames = [frame('a', { x: -20, y: 40, rotation: 45, groupId: 'g', locked: true }), frame('b', { x: 180, y: 140, groupId: 'g' })];
  const seen = [];
  const parsed = parseFrameClip(serializeFrames(frames), html => { seen.push(html); return '<p>Clean</p>'; });
  assert.deepEqual(seen, frames.map(item => item.html));
  assert.deepEqual(parsed, [
    { name: 'a', x: 0, y: 0, width: 100, height: 100, html: '<p>Clean</p>', styles: '', rotation: 45, groupKey: 'g' },
    { name: 'b', x: 200, y: 100, width: 100, height: 100, html: '<p>Clean</p>', styles: '', groupKey: 'g' },
  ]);
});

test('clipboard parsing rejects malformed, oversized and invalid payloads', () => {
  const clip = JSON.parse(serializeFrames([frame('a')]));
  for (const text of [null, undefined, '', '{', JSON.stringify({ ...clip, kind: 'other' }), ' '.repeat(192 * 1024 + 1), JSON.stringify({ ...clip, frames: [{ ...clip.frames[0], width: 5000 }] }), JSON.stringify({ ...clip, frames: Array(25).fill(clip.frames[0]) }), serializeFrames([])]) {
    assert.equal(parseFrameClip(text, () => { assert.fail('invalid clipboard must not be sanitized'); }), null);
  }
});

test('paste unlocks and offsets; duplicate names copies with a 40px offset', () => {
  const clips = parseFrameClip(serializeFrames([frame('a'), frame('b', { x: 200, y: 50 })]), identity);
  const pasted = pasteOperation(clips.map(item => ({ ...item, locked: true })), { x: 10, y: 20 });
  assert.equal(pasted.type, 'frames.paste');
  assert.deepEqual(pasted.frames.map(({ x, y }) => [x, y]), [[10, 20], [210, 70]]);
  assert.ok(pasted.frames.every(item => !Object.hasOwn(item, 'locked')));
  const duplicated = duplicateOperation([frame('a', { x: -20, y: 10 }), frame('b', { x: 180, y: 60 })]);
  assert.deepEqual(duplicated.frames.map(({ name, x, y }) => [name, x, y]), [['a copy', 20, 50], ['b copy', 220, 100]]);
});

test('dropped text is escaped and empty drops are rejected', () => {
  const dropped = droppedFrame({ text: '<script>"&\'</script>', name: 'note.txt' }, { x: 320, y: 240 }, identity);
  assert.equal(dropped.frames[0].name, 'note');
  assert.equal(dropped.frames[0].x, 0);
  assert.match(dropped.frames[0].html, /&#60;script&#62;&#34;&#38;&#39;&#60;\/script&#62;/);
  assert.equal(droppedFrame({}, { x: 0, y: 0 }, identity), null);
  assert.equal(droppedFrame({ text: '' }, { x: 0, y: 0 }, identity), null);
  assert.equal(droppedFrame({ html: '<script>x</script>' }, { x: 0, y: 0 }, () => ''), null);
});

function operationsFor(entry, current, direction) {
  const result = historyOperations(entry, current, direction);
  if ('operations' in result) {
    assert.deepEqual(designRequests['design.update'].parse({ session: newId('s'), slug: 'board', expectedRevision: current.revision, operations: result.operations }).operations, result.operations);
  }
  return result;
}

function applyOperations(current, operations, history = []) {
  const doc = structuredClone(current);
  for (const operation of operations) {
    if (operation.type === 'frame.update') Object.assign(doc.frames.find(item => item.id === operation.frameId), operation.patch);
    else if (operation.type === 'direction.select') doc.workingFrameId = operation.frameId;
    else if (operation.type === 'page.start') {
      const page = doc.pages.find(page => page.id === operation.pageId);
      if (operation.frameId) page.startFrameId = operation.frameId;
      else delete page.startFrameId;
    } else applyFrameOperation(doc, operation, message => { throw new Error(message); }, history);
  }
  return doc;
}

function roundtrip(before, after) {
  const entry = diffDocuments(before, after, 'Edit');
  assert.ok(entry);
  const undo = operationsFor(entry, after, 'undo');
  assert.ok('operations' in undo);
  const undone = applyOperations(after, undo.operations, [{ document: before }]);
  assert.deepEqual(undone.frames, before.frames);
  assert.equal(undone.workingFrameId, before.workingFrameId);
  const redo = operationsFor(entry, undone, 'redo');
  assert.ok('operations' in redo);
  assert.deepEqual(applyOperations(undone, redo.operations).frames, after.frames);
  return { entry, undo: undo.operations, redo: redo.operations, undone };
}

test('history ignores no-ops and comment-only edits', () => {
  const before = document([frame('a')]);
  assert.equal(diffDocuments(before, structuredClone(before), 'No-op'), null);
  assert.equal(diffDocuments(before, { ...before, comments: [note('n', 'a')] }, 'Comment'), null);
  assert.equal(diffDocuments(document(), document(), 'Empty'), null);
});

test('move history produces inverse and forward batch patches', () => {
  const { undo, redo } = roundtrip(document([frame('a')]), document([frame('a', { x: 50, y: 20 })]));
  assert.deepEqual(undo, [{ type: 'frames.set', frames: [{ frameId: 'a', patch: { x: 0, y: 0 } }] }]);
  assert.deepEqual(redo, [{ type: 'frames.set', frames: [{ frameId: 'a', patch: { x: 50, y: 20 } }] }]);
});

test('delete history restores original IDs, indexes, comments and working direction', () => {
  const before = document([frame('a'), frame('b'), frame('c')]);
  before.comments = [note('n', 'b')]; before.workingFrameId = 'b';
  const after = document([frame('a'), frame('c')]);
  const { undo, redo, undone } = roundtrip(before, after);
  assert.deepEqual(undo[0], { type: 'frames.restore', frames: [{ frame: frame('b'), index: 1 }], comments: before.comments });
  assert.deepEqual(redo[0], { type: 'frames.remove', frameIds: ['b'] });
  assert.deepEqual(undone.comments, before.comments);
});

test('paste and create history remove newly added frames on undo', () => {
  for (const added of [[frame('b')], [frame('b'), frame('c')]]) {
    const { undo } = roundtrip(document([frame('a')]), document([frame('a'), ...added]));
    assert.deepEqual(undo, [{ type: 'frames.remove', frameIds: added.map(item => item.id) }]);
  }
});

test('reorder history emits explicit frame orders', () => {
  const { undo, redo } = roundtrip(document([frame('a'), frame('b')]), document([frame('b'), frame('a')]));
  assert.deepEqual(undo, [{ type: 'frames.order', frameIds: ['a', 'b'] }]);
  assert.deepEqual(redo, [{ type: 'frames.order', frameIds: ['b', 'a'] }]);
});

test('history refuses undo after a remote frame edit or new feedback on a created frame', () => {
  const before = document([frame('a')]);
  const after = document([frame('a', { x: 20 })]);
  const moved = diffDocuments(before, after, 'Move');
  assert.match(operationsFor(moved, document([frame('a', { x: 30 })]), 'undo').error, /changed after this edit/);
  const created = document([frame('a'), frame('b')]);
  const entry = diffDocuments(before, created, 'Paste');
  assert.match(operationsFor(entry, { ...created, comments: [note('remote', 'b')] }, 'undo').error, /gained feedback/);
});

test('history represents absent layer fields with protocol-valid reset values', () => {
  const { undo, redo } = roundtrip(document([frame('a', { locked: true })]), document([frame('a')]));
  assert.deepEqual(undo, [{ type: 'frames.set', frames: [{ frameId: 'a', patch: { locked: true } }] }]);
  assert.deepEqual(redo, [{ type: 'frames.set', frames: [{ frameId: 'a', patch: { locked: false } }] }]);
  roundtrip(document([frame('a', { hidden: true, rotation: 45, groupId: 'g' }), frame('b', { groupId: 'g' })]), document([frame('a'), frame('b')]));
});

test('pushEntry retains at most 50 entries and stays within the byte budget', () => {
  const entry = diffDocuments(document([frame('a')]), document([frame('a', { x: 1 })]), 'Move');
  let stack = [];
  for (let i = 0; i < 55; i++) stack = pushEntry(stack, { ...entry, label: String(i) });
  assert.equal(stack.length, 50);
  assert.equal(stack[0].label, '5');
  const large = { ...entry, bytes: Math.floor(HISTORY_BYTES / 2) + 1 };
  const bounded = pushEntry([large], { ...large });
  assert.equal(bounded.length, 1);
  assert.ok(bounded.reduce((sum, item) => sum + item.bytes, 0) <= HISTORY_BYTES);
  assert.deepEqual(pushEntry([], { ...entry, bytes: HISTORY_BYTES + 1 }), []);
  assert.deepEqual(pushEntry([], entry), [entry]);
});
