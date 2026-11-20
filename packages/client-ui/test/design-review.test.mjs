import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activeMentionQuery, actorLabel, annotationAnchor, approvalLabel, extractMentions, filterThreads, mentionToken, targetLabel } from '../src/features/design/review/review-model.ts';

const frames = [{ id: 'f', name: 'Phone', x: 100, y: -50, width: 390, height: 844 }];
const comment = { id: 'c', frameId: null, session: 'legacy', text: 'Review', resolved: false, createdAt: 0 };
const sessions = [{ id: 's_one', title: 'Design Agent', vendor: 'fake' }, { id: 's_two', vendor: 'fake' }];

test('annotation anchors cover canvas, frame points, element, legacy and missing frames', () => {
  assert.deepEqual(annotationAnchor({ ...comment, point: { x: 4, y: 8 } }, frames), { x: 4, y: 8 });
  assert.deepEqual(annotationAnchor({ ...comment, frameId: 'f', point: { x: 4, y: 8 } }, frames), { x: 104, y: -42 });
  assert.deepEqual(annotationAnchor({ ...comment, frameId: 'f', path: '0.1' }, frames, 2), { x: 490, y: 38 });
  assert.deepEqual(annotationAnchor({ ...comment, frameId: 'f', element: 'button' }, frames), { x: 490, y: -26 });
  assert.equal(annotationAnchor(comment, frames), null);
  assert.equal(annotationAnchor({ ...comment, frameId: 'missing' }, frames), null);
  assert.match(targetLabel({ frameId: 'f', path: '0.1', element: 'button' }, frames), /Phone · button/);
  assert.equal(targetLabel({ frameId: null }, frames), 'Canvas');
});

test('actor labels include legacy sessions and approval and thread filters are explicit', () => {
  assert.equal(actorLabel({ kind: 'user', session: 's_one' }, sessions), 'You');
  assert.equal(actorLabel({ kind: 'agent', session: 's_one' }, sessions), 'Agent · Design Agent');
  assert.equal(actorLabel(undefined, sessions, 's_one'), 'Design Agent');
  assert.equal(actorLabel(undefined, sessions, 'legacy'), 'legacy');
  assert.equal(actorLabel(undefined, sessions), 'Unknown');
  assert.equal(approvalLabel({}), 'Draft');
  assert.equal(approvalLabel({ approval: { status: 'approved' } }), 'Approved');
  assert.equal(approvalLabel({ approval: { status: 'needs_review' } }), 'Needs review');
  const comments = [comment, { ...comment, id: 'r', resolved: true }];
  assert.deepEqual(filterThreads(comments, 'open'), [comment]);
  assert.deepEqual(filterThreads(comments, 'resolved'), [comments[1]]);
  assert.deepEqual(filterThreads([], 'open'), []);
});

test('mention query uses caret and extracts only mentionable title-or-id tokens, at most eight', () => {
  assert.deepEqual(activeMentionQuery('Hi @Des rest', 7), { query: 'Des', start: 3, end: 7 });
  assert.deepEqual(activeMentionQuery('@', 1), { query: '', start: 0, end: 1 });
  assert.equal(activeMentionQuery('hello', 5), null);
  assert.equal(activeMentionQuery('a@b', 3), null);
  assert.equal(activeMentionQuery('@Agent done', 11), null);
  assert.deepEqual(extractMentions('Hi @Design-Agent, @s_two! @s_one @outsider @Design-Agent-extra', sessions), ['s_one', 's_two']);
  assert.deepEqual(extractMentions('', sessions), []);
  assert.deepEqual(extractMentions('@s_one', []), []);
  const duplicates = sessions.map(item => ({ ...item, title: 'Same title' }));
  assert.equal(mentionToken(duplicates[1], duplicates), 's_two');
  assert.deepEqual(extractMentions('@Same-title @s_two', duplicates), ['s_two']);
  assert.equal(mentionToken({ id: 's_three', title: 'Hi, team!', vendor: 'fake' }), 's_three');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `s_${i}`, title: `Agent${i}`, vendor: 'fake' }));
  assert.equal(extractMentions(many.map(item => '@' + item.title).join(' '), many).length, 8);
});

test('version preview is script-less, CSP restricted and sanitized even with style breakouts', async () => {
  const dom = new JSDOM('');
  globalThis.window = dom.window;
  try {
    const { versionPreviewSrcDoc } = await import('../src/features/design/review/version-preview.ts');
    const doc = versionPreviewSrcDoc('<script>alert(1)</script><p onclick="bad()">Safe</p><iframe srcdoc="bad"></iframe><img src="https://bad.invalid/x" onerror="bad()">', 'p { color: red } </style><script>bad()</script>');
    assert.doesNotMatch(doc, /<script|onclick|onerror|srcdoc|bad\.invalid/i);
    assert.match(doc, /Content-Security-Policy/);
    assert.match(doc, /default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:/);
    assert.match(doc, /<p>Safe<\/p>/);
    const parsed = new JSDOM(doc);
    assert.equal(parsed.window.document.querySelectorAll('script, iframe').length, 0);
    assert.equal(parsed.window.document.querySelectorAll('style').length, 1);
    parsed.window.close();
    assert.match(versionPreviewSrcDoc('', ''), /<!doctype html>/);
  } finally { dom.window.close(); delete globalThis.window; }
});
