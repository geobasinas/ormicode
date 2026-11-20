import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPromptHistory } from '../src/features/session/prompt-history.ts';

test('rapid query changes debounce to one bounded request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = []; const received = [];
  const transport = { request: async (method, body) => { calls.push({ method, body }); return { type: 'res', body: { items: [] } }; } };
  let cancel = loadPromptHistory(transport, '/repo', 'f', items => received.push(items));
  t.mock.timers.tick(100); cancel();
  cancel = loadPromptHistory(transport, '/repo', 'fi', items => received.push(items));
  t.mock.timers.tick(100); cancel();
  cancel = loadPromptHistory(transport, '/repo', 'fix', items => received.push(items));
  t.mock.timers.tick(180); await Promise.resolve();
  assert.deepEqual(calls, [{ method: 'prompts.history', body: { project: '/repo', query: 'fix', limit: 50 } }]);
  assert.deepEqual(received, [[]]); cancel();
});

test('stale responses and request errors do not replace current results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve;
  const received = [];
  const cancel = loadPromptHistory({ request: () => new Promise(done => { resolve = done; }) }, undefined, '', items => received.push(items), 0);
  t.mock.timers.tick(0); cancel();
  resolve({ type: 'res', body: { items: [{ text: 'stale', createdAt: 1 }] } });
  await Promise.resolve();
  assert.deepEqual(received, []);
  const stop = loadPromptHistory({ request: async () => { throw new Error('offline'); } }, undefined, '', items => received.push(items), 0);
  t.mock.timers.tick(0); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(received, []); stop();
});
