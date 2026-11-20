import test from 'node:test';
import assert from 'node:assert/strict';
import { containsSession, needsUser, sessionForest } from '../src/features/session/team-tree.ts';
import { saveTranscriptPosition, transcriptPosition } from '../src/features/session/transcript-position.ts';

const session = (id, extra = {}) => ({ id, state: 'idle', project: 'project', title: id, ...extra });
test('teams nest children once and aggregate parent/child/cache-inclusive token counts without merging handoffs', () => {
  const rows = [session('child', { team: 'team', parent: 'parent', tokens: 200, parentless: true }), session('parent', { team: 'team', tokens: 100, state: 'done' }),
    session('handoff', { parent: 'parent', tokens: 50 }), session('grandchild', { team: 'nested', parent: 'child', tokens: 300 })];
  const tree = sessionForest(rows), parent = tree.find(n => n.session.id === 'parent');
  assert.equal(tree.length, 2); assert.equal(parent.tokens, 600); assert.equal(parent.children.length, 1);
  assert.equal(parent.children[0].tokens, 500); assert.equal(parent.children[0].session.parentless, true);
  assert.equal(containsSession(parent, 'grandchild'), true); assert.equal(containsSession(parent, 'handoff'), false);
  assert.equal(parent.children[0].session.tokens, 200, 'per-child cost excludes its own children');
});
test('search preserves ancestors and whole-team totals, matching parents include descendants', () => {
  const rows = [session('parent', { tokens: 100, teamTokens: 1000 }), session('found', { parent: 'parent', team: 't', tokens: 200 }), session('other', { parent: 'parent', team: 't', tokens: 300 })];
  const match = sessionForest(rows, 'FOUND'); assert.equal(match.length, 1); assert.equal(match[0].tokens, 1000);
  assert.deepEqual(match[0].children.map(n => n.session.id), ['found']);
  assert.equal(sessionForest(rows, 'parent')[0].children.length, 2);
  assert.deepEqual(sessionForest(rows, 'absent'), []); assert.deepEqual(sessionForest([]), []);
});
test('missing/archived parents and malformed cycles never hide children or recurse forever; unknown usage is zero', () => {
  for (const rows of [[session('child', { parent: 'missing', team: 't', parentless: true })],
    [session('parent', { state: 'archived' }), session('child', { parent: 'parent', team: 't' })],
    [session('a', { parent: 'b', team: 't' }), session('b', { parent: 'a', team: 't' })]]) {
    const tree = sessionForest(rows); assert.ok(tree.length); assert.equal(tree[0].tokens, 0);
  }
  assert.deepEqual(sessionForest([session('archived', { state: 'archived' })]), []);
});
test('delegated approvals never need user attention; user approvals and parentless questions still do', () => {
  assert.equal(needsUser(session('child', { state: 'awaiting_approval', delegatedApproval: true })), false);
  assert.equal(needsUser(session('child', { state: 'awaiting_approval' })), true);
  assert.equal(needsUser(session('child', { state: 'awaiting_input', parentless: true })), true);
});
test('parent and child transcript positions stay separate, including follow mode and bounded history', () => {
  assert.equal(transcriptPosition('unknown'), undefined);
  saveTranscriptPosition('parent', 480, false); saveTranscriptPosition('child', 120, true);
  assert.deepEqual(transcriptPosition('parent'), { top: 480, following: false });
  assert.deepEqual(transcriptPosition('child'), { top: 120, following: true });
  saveTranscriptPosition('negative', -12, false); assert.equal(transcriptPosition('negative').top, 0);
  for (let i = 0; i < 100; i++) saveTranscriptPosition(`session-${i}`, i, true);
  assert.equal(transcriptPosition('parent'), undefined);
});
