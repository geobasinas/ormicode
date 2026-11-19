import assert from 'node:assert/strict';
import test from 'node:test';
import { finishTurnCheckpoints } from '../src/turn-checkpoints.ts';
import { UiCheckFollowupGuard } from '../src/ui-check.ts';

const pending = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('queue drains before checkpoint screenshot when a UI check is not required', async () => {
  const result = pending();
  const drained = [];
  const scheduler = { end: async () => ({ shouldCheck: false, result: result.promise }) };
  finishTurnCheckpoints('s_test', scheduler, new UiCheckFollowupGuard(), () => {}, () => {}, async session => { drained.push(session); return true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(drained, ['s_test']);
  result.resolve(undefined);
});

test('UI check timeout drains the queue and later journals results without a follow-up', async () => {
  const result = pending();
  const drained = [];
  const events = [];
  const enqueued = [];
  const guard = new UiCheckFollowupGuard();
  const scheduler = { end: async () => ({ shouldCheck: true, result: result.promise }) };
  finishTurnCheckpoints('s_test', scheduler, guard, (_session, text) => enqueued.push(text),
    (_session, kind, body) => events.push({ kind, body }), async session => { drained.push(session); return true; }, 5);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(drained, ['s_test']);
  result.resolve({ errors: 1, warnings: 0, path: '/', checkpoint: 'cp', artifact: 'bl', url: 'http://localhost/', consoleIds: ['c1'], entries: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events[0].kind, 'ui_check');
  assert.equal(events[0].body.followup, false);
  assert.deepEqual(enqueued, []);
  assert.equal(guard.count('s_test'), 0);
});
