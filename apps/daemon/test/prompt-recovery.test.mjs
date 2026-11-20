import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, getSession, setState } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { createPromptDelivery } from '../src/prompt-delivery.ts';

function fixture(t, state, responses) {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 's', machine: 'm', cwd: '/repo', project: '/repo', vendor: 'claude', transport: 'sdk' });
  setState(db, 's', state);
  const calls = [], restarted = [];
  const options = { db, notesDir: '/repo', paused: new Set(), heldPrompts: new Map(), lastPrompt: new Map(),
    ensureWorker: async () => {}, restartWorker: async session => { restarted.push(session); setState(db, session, 'idle'); },
    terminals: {}, previewEntries: () => [],
    record(session, kind, payload) { append(db, session, { kind, payload }); if (kind === 'state') setState(db, session, payload.state); },
    toWorker: async (_session, _method, body) => {
      calls.push(body); assert.equal(getSession(db, 's').state, 'starting');
      const response = responses.shift(); if (response instanceof Error) throw response; return response;
    },
  };
  return { ...createPromptDelivery(options), db, calls, restarted, options };
}
const rejected = { type: 'err', code: 'agent.failed', message: 'session already has an active turn' };
const accepted = { type: 'res', body: { accepted: true } };

for (const state of ['interrupted', 'idle', 'done']) test(`a rejected ${state} worker is restarted and the prompt is accepted exactly once`, async t => {
  const f = fixture(t, state, [rejected, accepted]);
  assert.equal(await f.sendPrompt('s', 'continue', [{ data: 'image', mimeType: 'image/png' }]), true);
  assert.deepEqual(f.restarted, ['s']); assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(replay(f.db, 's').filter(event => event.kind === 'prompt').length, 1);
});
test('recovery is bounded and preserves rejected state without journaling an undelivered prompt', async t => {
  const f = fixture(t, 'interrupted', [rejected, rejected]);
  assert.equal(await f.sendPrompt('s', 'retry'), false); assert.equal(f.calls.length, 2);
  assert.equal(getSession(f.db, 's').state, 'interrupted');
  assert.equal(replay(f.db, 's').filter(event => event.kind === 'prompt').length, 0);
  assert.equal(f.options.lastPrompt.size, 0);
});
test('busy sessions, other errors, absent replies and ambiguous transport failures are never replayed', async t => {
  for (const [state, response] of [['running', rejected], ['awaiting_approval', rejected], ['interrupted', undefined], ['idle', { type: 'err', code: 'prompt.invalid' }], ['interrupted', new Error('timed out')]]) {
    const f = fixture(t, state, [response]);
    if (response instanceof Error) await assert.rejects(f.sendPrompt('s', 'continue'), /timed out/);
    else assert.equal(await f.sendPrompt('s', 'continue'), false);
    assert.deepEqual(f.restarted, []); assert.equal(f.calls.length, 1);
  }
});
test('successful dispatch and missing sessions need no recovery', async t => {
  const f = fixture(t, 'idle', [accepted]);
  assert.equal(await f.sendPrompt('missing', 'continue'), false);
  assert.equal(await f.sendPrompt('s', 'continue'), true);
  assert.deepEqual(f.restarted, []); assert.equal(f.calls.length, 1);
});
test('an adapter that already started work is not restarted on its error reply', async t => {
  const f = fixture(t, 'interrupted', []);
  f.options.toWorker = async () => { setState(f.db, 's', 'running'); return rejected; };
  assert.equal(await f.sendPrompt('s', 'continue'), false);
  assert.deepEqual(f.restarted, []);
  assert.equal(getSession(f.db, 's').state, 'running');
});
