import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@ormicode/protocol';
import { applyFrameOperation, normalizeGroups, reorderSlots, stackOrder } from '../src/design-frame-ops.ts';
import { startDaemon, connect } from '../src/index.ts';

const content = { name: 'Frame', x: 0, y: 0, width: 390, height: 844, html: '', styles: '' };
const frame = id => ({ id, ...content });
const document = (ids = ['a', 'b', 'c', 'd']) => ({ version: 1, name: 'Board', revision: 1, frames: ids.map(frame), workingFrameId: null, comments: [] });
const ids = doc => doc.frames.map(item => item.id);
const apply = (doc, operation) => applyFrameOperation(doc, operation, message => { throw new Error(message); });
const comment = (id, frameId) => ({ id, frameId, text: 'Note', resolved: false, session: newId('s'), createdAt: 1 });

test('stackOrder preserves selection order in all directions and blocks boundary moves', () => {
  const peers = ['a', 'b', 'c', 'd', 'e'];
  for (const [to, expected] of [
    ['front', ['a', 'c', 'e', 'b', 'd']], ['back', ['b', 'd', 'a', 'c', 'e']],
    ['forward', ['a', 'c', 'b', 'e', 'd']], ['backward', ['b', 'a', 'd', 'c', 'e']],
  ]) assert.deepEqual(stackOrder(peers, new Set(['d', 'b']), to), expected);
  assert.deepEqual(stackOrder(peers, new Set(['d', 'e']), 'forward'), peers);
  assert.deepEqual(stackOrder(peers, new Set(['a', 'b']), 'backward'), peers);
  assert.deepEqual(stackOrder(peers, new Set(['b', 'c']), 'forward'), ['a', 'd', 'b', 'c', 'e']);
  assert.deepEqual(stackOrder(peers, new Set(['b', 'c']), 'backward'), ['b', 'c', 'a', 'd', 'e']);
  for (const to of ['front', 'back', 'forward', 'backward']) {
    assert.deepEqual(stackOrder(peers, new Set(), to), peers);
    assert.deepEqual(stackOrder([], new Set(), to), []);
    assert.deepEqual(stackOrder(peers, new Set(peers), to), peers);
  }
});

test('reorderSlots fills selected slots without changing other frames or the input', () => {
  const frames = document().frames;
  assert.deepEqual(reorderSlots(frames, ['d', 'b']), [frames[0], frames[3], frames[2], frames[1]]);
  assert.deepEqual(frames.map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(reorderSlots(frames, []), frames);
  assert.deepEqual(reorderSlots([], []), []);
});

test('normalizeGroups dissolves singleton groups but retains multi-member groups', () => {
  const doc = document();
  doc.frames[0].groupId = doc.frames[1].groupId = 'pair';
  doc.frames[2].groupId = 'alone';
  normalizeGroups(doc);
  assert.deepEqual(doc.frames.map(item => item.groupId), ['pair', 'pair', undefined, undefined]);
  normalizeGroups(document([]));
});

test('frames.set patches a batch and normalizes default layer fields away', () => {
  const doc = document();
  apply(doc, { type: 'frames.set', frames: [{ frameId: 'a', patch: { rotation: 12.345, groupId: 'pair', locked: true, hidden: true } }, { frameId: 'b', patch: { x: 40, name: 'Moved' } }] });
  assert.deepEqual(doc.frames[0], { ...frame('a'), rotation: 12.35, groupId: 'pair', locked: true, hidden: true });
  assert.equal(doc.frames[1].x, 40);
  assert.equal(doc.frames[1].name, 'Moved');
  apply(doc, { type: 'frames.set', frames: [{ frameId: 'a', patch: { rotation: 0, groupId: null, locked: false, hidden: false } }, { frameId: 'b', patch: {} }] });
  assert.deepEqual(doc.frames[0], frame('a'));
});

test('frames.remove removes associated comments and clears the working frame', () => {
  const doc = document();
  const kept = [comment('board', null), comment('kept', 'c')];
  doc.comments = [comment('removed', 'a'), ...kept, comment('also-removed', 'b')];
  doc.workingFrameId = 'a';
  apply(doc, { type: 'frames.remove', frameIds: ['a', 'b'] });
  assert.deepEqual(ids(doc), ['c', 'd']);
  assert.deepEqual(doc.comments, kept);
  assert.equal(doc.workingFrameId, null);
});

test('frames.order and frames.stack update stacking order', () => {
  const doc = document();
  apply(doc, { type: 'frames.order', frameIds: ['d', 'b'] });
  assert.deepEqual(ids(doc), ['a', 'd', 'c', 'b']);
  apply(doc, { type: 'frames.stack', frameIds: ['a', 'c'], to: 'front' });
  assert.deepEqual(ids(doc), ['d', 'b', 'a', 'c']);
});

test('frames.group assigns a fresh shared ID and frames.ungroup clears it', () => {
  const doc = document();
  apply(doc, { type: 'frames.group', frameIds: ['a', 'c'] });
  const groupId = doc.frames[0].groupId;
  assert.ok(groupId);
  assert.equal(doc.frames[2].groupId, groupId);
  assert.equal(doc.frames[1].groupId, undefined);
  apply(doc, { type: 'frames.ungroup', groupId });
  assert.ok(doc.frames.every(item => !Object.hasOwn(item, 'groupId')));
  assert.throws(() => apply(doc, { type: 'frames.ungroup', groupId }), /Group not found/);
});

test('frames.paste creates fresh IDs, remaps group keys per paste and normalizes layers', () => {
  const doc = document([]);
  const operation = { type: 'frames.paste', frames: [
    { ...content, groupKey: 'pair', rotation: 0, locked: false, hidden: false },
    { ...content, groupKey: 'pair', rotation: 45, locked: true, hidden: true },
    { ...content, groupKey: 'other' }, { ...content },
  ] };
  apply(doc, operation);
  const groupId = doc.frames[0].groupId;
  assert.ok(groupId && groupId !== 'pair');
  assert.equal(doc.frames[1].groupId, groupId);
  assert.notEqual(doc.frames[2].groupId, groupId);
  assert.deepEqual(doc.frames[0], { ...frame(doc.frames[0].id), groupId });
  assert.deepEqual(doc.frames[1], { ...frame(doc.frames[1].id), groupId, rotation: 45, locked: true, hidden: true });
  assert.deepEqual(doc.frames[3], frame(doc.frames[3].id));
  assert.ok(doc.frames.every(item => !Object.hasOwn(item, 'groupKey')));
  apply(doc, operation);
  assert.equal(new Set(ids(doc)).size, 8);
  assert.notEqual(doc.frames[4].groupId, groupId);
  const full = document(Array.from({ length: 24 }, (_, i) => `f${i}`));
  const before = structuredClone(full);
  assert.throws(() => apply(full, { type: 'frames.paste', frames: [content] }), /at most 24/);
  assert.deepEqual(full, before);
});

test('frames.restore inserts original IDs at sorted indexes and restores comments', () => {
  const doc = document(['b', 'd']);
  const note = comment('note', 'a');
  const boardNote = comment('board', null);
  doc.comments = [boardNote];
  apply(doc, { type: 'frames.restore', frames: [{ frame: frame('c'), index: 2 }, { frame: { ...frame('a'), rotation: 0, locked: false, hidden: false }, index: 0 }, { frame: frame('e'), index: 24 }], comments: [note, boardNote] });
  assert.deepEqual(ids(doc), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(doc.frames[0], frame('a'));
  assert.deepEqual(doc.comments, [boardNote, note]);
  assert.throws(() => apply(doc, { type: 'frames.restore', frames: [{ frame: frame('a'), index: 0 }] }), /Frame already exists: a/);
  assert.throws(() => apply(doc, { type: 'frames.restore', frames: [{ frame: frame('f'), index: 0 }], comments: [comment('bad', 'missing')] }), /Frame not found: missing/);
  const full = document(Array.from({ length: 24 }, (_, i) => `f${i}`));
  assert.throws(() => apply(full, { type: 'frames.restore', frames: [{ frame: frame('extra'), index: 0 }] }), /at most 24/);
});

test('ID-based batch operations reject unknown and duplicate IDs before mutating', () => {
  for (const type of ['frames.set', 'frames.remove', 'frames.order', 'frames.stack', 'frames.group']) {
    for (const [frameIds, error] of [[['a', 'missing'], /Frame not found: missing/], [['a', 'a'], /Frame IDs must be unique/]]) {
      const doc = document();
      const before = structuredClone(doc);
      const operation = type === 'frames.set' ? { type, frames: frameIds.map(frameId => ({ frameId, patch: { x: 99 } })) } : { type, frameIds, ...(type === 'frames.stack' ? { to: 'front' } : {}) };
      assert.throws(() => apply(doc, operation), error);
      assert.deepEqual(doc, before);
    }
  }
});

test('daemon layer batches are atomic, load legacy boards and retain prior revisions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-design-layers-'));
  const project = join(dir, 'project'); mkdirSync(project);
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  try {
    const started = await client.request('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
    assert.equal(started.type, 'res');
    const board = { session: started.body.session, slug: 'layers' };
    assert.equal((await client.request('design.create', { ...board, name: 'Layers' })).type, 'res');
    const legacy = document(['a', 'b', 'c']);
    const path = join(project, 'designs', 'layers', 'workspace.json');
    writeFileSync(path, JSON.stringify({ document: legacy, history: [] }));
    const loaded = await client.request('design.get', board);
    assert.equal(loaded.type, 'res');
    assert.deepEqual(loaded.body.document, legacy);
    const failed = await client.request('design.update', { ...board, expectedRevision: 1, operations: [{ type: 'frames.set', frames: [{ frameId: 'a', patch: { x: 100, locked: true } }, { frameId: 'missing', patch: { hidden: true } }] }] });
    assert.equal(failed.code, 'design.invalid');
    assert.deepEqual((await client.request('design.get', board)).body.document, legacy);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { document: legacy, history: [] });
    let current = legacy;
    const snapshots = [structuredClone(legacy)];
    const update = async operation => {
      const result = await client.request('design.update', { ...board, expectedRevision: current.revision, operations: [operation] });
      assert.equal(result.type, 'res');
      assert.equal(result.body.document.revision, current.revision + 1);
      current = result.body.document;
      snapshots.push(structuredClone(current));
    };
    await update({ type: 'frames.set', frames: [{ frameId: 'a', patch: { rotation: 30, locked: true } }, { frameId: 'b', patch: { hidden: true } }] });
    assert.equal(current.frames[0].rotation, 30);
    assert.equal(current.frames[0].locked, true);
    assert.equal(current.frames[1].hidden, true);
    await update({ type: 'frames.group', frameIds: ['a', 'b'] });
    const groupId = current.frames[0].groupId;
    assert.ok(groupId);
    assert.equal(current.frames[1].groupId, groupId);
    await update({ type: 'frames.ungroup', groupId });
    assert.ok(current.frames.every(item => !Object.hasOwn(item, 'groupId')));
    await update({ type: 'frames.stack', frameIds: ['a'], to: 'front' });
    assert.deepEqual(ids(current), ['b', 'c', 'a']);
    const history = await client.request('design.history', board);
    assert.equal(history.type, 'res');
    assert.deepEqual(history.body.history.map(item => item.revision), [1, 2, 3, 4]);
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(stored.history.map(item => item.document), snapshots.slice(0, -1));
    const restored = await client.request('design.restore', { ...board, expectedRevision: 5, targetRevision: 3 });
    assert.equal(restored.type, 'res');
    assert.deepEqual(restored.body.document, { ...snapshots[2], revision: 6 });
  } finally {
    client.close(); await daemon.close(); rmSync(dir, { recursive: true, force: true });
  }
});
