import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designDocumentSchema, designOperationSchema, designResponses, newId } from '../src/index.ts';

const session = newId('s');
const actor = { kind: 'user', session, device: 'test' };
const frame = { id: 'f', name: 'Frame', x: 0, y: 0, width: 100, height: 100, html: '', styles: '' };
const comment = { id: 'c', frameId: null, text: 'Review', resolved: false, session, createdAt: 0 };
const document = { version: 1, name: 'Old', revision: 1, frames: [frame], comments: [comment], workingFrameId: null };

test('old v1 documents parse unchanged and review fields are bounded', () => {
  assert.deepEqual(designDocumentSchema.parse(document), document);
  const parseComment = fields => designDocumentSchema.safeParse({ ...document, comments: [{ ...comment, ...fields }] }).success;
  assert.equal(parseComment({ point: { x: -100000, y: 100000 }, author: actor, path: '0.12345', mentions: [session], replies: [], resolvedAt: 0, resolvedBy: actor }), true);
  for (const fields of [
    { point: { x: 100001, y: 0 } }, { point: { x: 0, y: Infinity } },
    { path: '123456' }, { path: Array(25).fill('0').join('.') }, { path: '-1' },
    { mentions: Array(9).fill(session) }, { author: { ...actor, device: '' } },
    { author: { ...actor, device: 'x'.repeat(81) } },
    { replies: Array(51).fill({ id: 'r', text: 'x', author: actor, createdAt: 0 }) },
    { replies: [{ id: 'r', text: '', author: actor, createdAt: 0 }] },
    { replies: [{ id: 'r', text: 'x'.repeat(2001), author: actor, createdAt: 0 }] },
  ]) assert.equal(parseComment(fields), false, JSON.stringify(fields).slice(0, 100));
  const approval = { status: 'approved', by: actor, at: 0, revision: 1, contentHash: 'a'.repeat(64) };
  assert.equal(designDocumentSchema.safeParse({ ...document, frames: [{ ...frame, approval }] }).success, true);
  assert.equal(designDocumentSchema.safeParse({ ...document, frames: [{ ...frame, approval: { ...approval, contentHash: 'bad' } }] }).success, false);
  assert.equal(parseComment({ replies: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, text: 'x'.repeat(2000), author: actor, createdAt: 0 })) }), false);
});

test('review operations reject forged attribution and invalid bounds', () => {
  const add = { type: 'comment.add', frameId: null, text: 'x', point: { x: 0, y: 0 } };
  assert.equal(designOperationSchema.safeParse(add).success, true);
  for (const fields of [{ author: actor }, { session }, { createdAt: 0 }, { resolvedBy: actor }]) {
    assert.equal(designOperationSchema.safeParse({ ...add, ...fields }).success, false);
  }
  const reply = { type: 'comment.reply', commentId: 'c', text: 'Reply', mentions: [session] };
  assert.equal(designOperationSchema.safeParse(reply).success, true);
  assert.equal(designOperationSchema.safeParse({ ...reply, author: actor }).success, false);
  assert.equal(designOperationSchema.safeParse({ type: 'frame.restoreVersion', frameId: 'f', revision: 0 }).success, false);
  assert.equal(designResponses['design.mentionable'].safeParse({ sessions: Array(101).fill({ id: session, vendor: 'fake' }) }).success, false);
});
