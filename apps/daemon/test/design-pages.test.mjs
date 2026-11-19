import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesign, getDesign, updateDesign } from '../src/design-store.ts';
import { newId } from '@ormicode/protocol';

const fields = { name: 'Frame', x: 0, y: 0, width: 100, height: 100, html: '', styles: '' };
const session = newId('s');
test('page operations use atomic CAS, preserve legacy ownership and remap duplicate IDs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pages-'));
  try {
    let document = createDesign(dir, 'board', 'Board').document;
    const apply = (...operations) => (document = updateDesign(dir, 'board', document.revision, operations, session).document);
    const invalid = (...operations) => assert.throws(() => apply(...operations), error => error.code === 'design.invalid');
    apply({ type: 'frame.add', ...fields });
    assert.equal(getDesign(dir, 'board').document.pages, undefined);
    const frame = document.frames[0].id;
    apply({ type: 'page.add', name: 'Other' });
    assert.equal(document.frames[0].pageId, 'default');
    const other = document.pages[1].id;
    apply({ type: 'page.move', pageId: other, index: 0 });
    assert.equal(document.frames[0].pageId, 'default');
    apply({ type: 'page.rename', pageId: other, name: 'Changed' }, { type: 'page.background', pageId: other, background: '#abcdef' });
    assert.equal(document.pages[0].name, 'Changed');
    assert.equal(document.pages[0].background, '#abcdef');
    apply({ type: 'page.background', pageId: other, background: null });
    assert.equal(document.pages[0].background, undefined);
    invalid({ type: 'page.start', pageId: other, frameId: frame });
    apply({ type: 'page.start', pageId: 'default', frameId: frame }, { type: 'guide.add', pageId: 'default', axis: 'x', at: 20 });
    const guide = document.pages[1].guides[0].id;
    apply({ type: 'guide.move', pageId: 'default', guideId: guide, at: 30 });
    assert.equal(document.pages[1].guides[0].at, 30);
    apply({ type: 'comment.add', frameId: frame, text: 'Original only' }, { type: 'page.duplicate', pageId: 'default' });
    const copy = document.pages[2];
    assert.equal(copy.name, 'Page 1 copy');
    assert.notEqual(copy.startFrameId, frame);
    assert.equal(document.frames.find(item => item.id === copy.startFrameId).pageId, copy.id);
    assert.notEqual(copy.guides[0].id, guide);
    assert.equal(document.comments.length, 1);
    apply({ type: 'frame.update', frameId: frame, patch: { pageId: other } });
    assert.equal(document.pages[1].startFrameId, undefined);
    apply({ type: 'frame.remove', frameId: copy.startFrameId });
    assert.equal(document.pages[2].startFrameId, undefined);
    apply({ type: 'guide.remove', pageId: 'default', guideId: guide });
    assert.deepEqual(document.pages[1].guides, []);
    apply({ type: 'direction.select', frameId: frame }, { type: 'page.remove', pageId: other });
    assert.equal(document.comments.length, 0);
    assert.equal(document.workingFrameId, null);
    apply({ type: 'page.remove', pageId: copy.id });
    invalid({ type: 'page.remove', pageId: 'default' });
    assert.throws(() => updateDesign(dir, 'board', 1, [{ type: 'page.add', name: 'Stale' }], 's_test'), error => error.code === 'design.conflict');
    assert.equal(getDesign(dir, 'board').document.revision, document.revision);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('frame page assignment materializes legacy pages and duplication respects frame cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pages-'));
  try {
    let document = createDesign(dir, 'board', 'Board').document;
    const apply = operations => (document = updateDesign(dir, 'board', document.revision, operations, 's_test').document);
    apply([{ type: 'frame.add', ...fields }, { type: 'frame.add', ...fields, pageId: 'default' }]);
    assert.ok(document.frames.every(frame => frame.pageId === 'default'));
    apply(Array.from({ length: 22 }, () => ({ type: 'frame.add', ...fields })));
    assert.throws(() => apply([{ type: 'page.duplicate', pageId: 'default' }]), error => error.code === 'design.invalid');
    assert.equal(getDesign(dir, 'board').document.frames.length, 24);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('multi-frame operations preserve page ownership and prototype starts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pages-'));
  try {
    let document = createDesign(dir, 'board', 'Board').document;
    const apply = (...operations) => (document = updateDesign(dir, 'board', document.revision, operations, session).document);
    apply({ type: 'page.add', name: 'Other' });
    const pageId = document.pages[1].id;
    apply({ type: 'frames.paste', frames: [{ ...fields, pageId, groupKey: 'copy' }, { ...fields, pageId, groupKey: 'copy' }] });
    const [start, peer] = document.frames;
    assert.equal(start.pageId, pageId);
    assert.equal(start.groupId, peer.groupId);
    apply({ type: 'page.start', pageId, frameId: start.id }, { type: 'page.duplicate', pageId });
    const duplicate = document.frames.find(frame => frame.pageId === document.pages[2].id);
    assert.notEqual(duplicate.groupId, start.groupId);
    apply({ type: 'comment.add', frameId: null, pageId, point: { x: 10, y: 10 }, text: 'Here' });
    apply({ type: 'frames.remove', frameIds: [start.id, peer.id] });
    assert.equal(document.pages[1].startFrameId, undefined);
    apply({ type: 'frames.restore', frames: [{ frame: start, index: 0 }, { frame: peer, index: 1 }] },
      { type: 'page.start', pageId, frameId: start.id });
    assert.equal(document.pages[1].startFrameId, start.id);
    apply({ type: 'page.remove', pageId });
    assert.equal(document.comments.length, 0);
    assert.equal(document.frames.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('duplicating a page rebinds local prototype links and preserves cross-page links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pages-'));
  try {
    let document = createDesign(dir, 'board', 'Board').document;
    const apply = (...operations) => (document = updateDesign(dir, 'board', document.revision, operations, session).document);
    apply({ type: 'page.add', name: 'Other' });
    const other = document.pages[1].id;
    apply(...['default', 'default', other].map(pageId => ({ type: 'frame.add', ...fields, pageId })));
    const [start, next, external] = document.frames;
    const example = `<!-- data-ormi-prototype="frame:${next.id}" -->`;
    const html = `${example}<button DATA-ORMI-PROTOTYPE='frame&#58;${next.id}'>Next</button><div data-ormi-prototype="overlay:${next.id}">Open</div><div data-ormi-prototype="frame:${external.id}">Other</div>`;
    apply({ type: 'frame.update', frameId: start.id, patch: { html } }, { type: 'page.start', pageId: 'default', frameId: start.id },
      { type: 'page.duplicate', pageId: 'default' });
    const [copy, copyNext] = document.frames.slice(-2);
    assert.equal(document.pages[1].startFrameId, copy.id);
    assert.equal(copy.html, `${example}<button data-ormi-prototype="frame:${copyNext.id}">Next</button><div data-ormi-prototype="overlay:${copyNext.id}">Open</div><div data-ormi-prototype="frame:${external.id}">Other</div>`);
    assert.equal(document.frames[0].html, html);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
