import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSIONS_CHANGED, matchArchived, setSessionArchived } from '../src/features/session/session-archive.ts';

// Node's global scope is not an EventTarget; give it the window methods the module uses.
const target = new EventTarget();
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[name] ??= target[name].bind(target);

const transport = reply => {
  const calls = [];
  return { calls, request: async (method, body) => { calls.push([method, body]); return reply(method); } };
};
const changes = () => {
  let count = 0;
  const on = () => { count++; };
  globalThis.addEventListener(SESSIONS_CHANGED, on);
  return { get count() { return count; }, stop: () => globalThis.removeEventListener(SESSIONS_CHANGED, on) };
};

test('archive and restore refresh session lists as soon as the daemon confirms', async () => {
  const seen = changes();
  try {
    const t = transport(method => ({ v: 1, type: 'res', id: 'r', ok: true, body: { archived: method === 'session.archive' } }));
    assert.equal(await setSessionArchived(t, 's_1', true), undefined);
    assert.equal(await setSessionArchived(t, 's_1', false), undefined);
    assert.deepEqual(t.calls, [['session.archive', { session: 's_1' }], ['session.unarchive', { session: 's_1' }]]);
    assert.equal(seen.count, 2);
  } finally { seen.stop(); }
});

test('a rejected archive or restore reports the error and leaves lists alone', async () => {
  const seen = changes();
  try {
    const failed = transport(() => ({ v: 1, type: 'err', id: 'r', code: 'lease.conflict', message: 'workspace held by s_2' }));
    assert.equal(await setSessionArchived(failed, 's_1', false), 'workspace held by s_2');
    const offline = { request: async () => { throw new Error('offline'); } };
    assert.equal(await setSessionArchived(offline, 's_1', true), 'offline');
    assert.equal(seen.count, 0);
  } finally { seen.stop(); }
});

test('archived search matches title, id, project and branch', () => {
  const sessions = [
    { id: 's_alpha', state: 'archived', project: '/repo/one', title: 'Extra session epsilon', branch: 'feat/x' },
    { id: 's_beta', state: 'archived', project: 'scratch', title: null },
  ];
  assert.deepEqual(matchArchived(sessions, '').map(s => s.id), ['s_alpha', 's_beta']);
  assert.deepEqual(matchArchived(sessions, ' EPSILON ').map(s => s.id), ['s_alpha']);
  assert.deepEqual(matchArchived(sessions, 'beta').map(s => s.id), ['s_beta']);
  assert.deepEqual(matchArchived(sessions, 'feat/').map(s => s.id), ['s_alpha']);
  assert.deepEqual(matchArchived(sessions, 'scratch').map(s => s.id), ['s_beta']);
  assert.deepEqual(matchArchived(sessions, 'nothing'), []);
});
