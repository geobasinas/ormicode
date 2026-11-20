import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, getSession, setState } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { createPromptDelivery } from '../src/prompt-delivery.ts';

test('prompt dispatch reserves activity before an early adapter acknowledgement and restores rejected dispatches', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'child', machine: 'm', cwd: '/repo', project: '/repo', vendor: 'codex', transport: 'sdk' });
  let response = 'ack';
  const options = {
    db, notesDir: '/repo', paused: new Set(), heldPrompts: new Map(), lastPrompt: new Map(),
    ensureWorker: async () => {}, terminals: {}, previewEntries: () => [],
    record(session, kind, payload) {
      append(db, session, { kind, payload });
      if (kind === 'state') setState(db, session, payload.state);
    },
    async toWorker() {
      assert.equal(getSession(db, 'child').state, 'starting');
      if (response === 'throw') throw new Error('worker closed');
      if (response === 'ended') setState(db, 'child', 'idle');
      return response === 'missing' ? undefined : { type: response === 'error' ? 'err' : 'res' };
    },
  };
  const delivery = createPromptDelivery(options);
  assert.equal(await delivery.sendPrompt('child', 'task'), true);
  assert.equal(getSession(db, 'child').state, 'starting');
  assert.equal(replay(db, 'child')[0].kind, 'state');
  for (response of ['error', 'missing', 'throw', 'ended']) {
    setState(db, 'child', 'idle');
    if (response === 'throw') await assert.rejects(delivery.sendPrompt('child', 'retry'), /worker closed/);
    else assert.equal(await delivery.sendPrompt('child', 'retry'), response === 'ended');
    assert.equal(getSession(db, 'child').state, 'idle');
  }
});
