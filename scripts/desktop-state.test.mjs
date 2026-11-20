import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeState } from '../apps/desktop/src/preload/state.ts';

test('subscription fetches state even when the first event was sent before preload', async () => {
  const states = []; let listener;
  subscribeState(state => states.push(state), cb => { listener = cb; }, async () => 'online');
  await Promise.resolve();
  assert.deepEqual(states, ['online']);
  listener('offline'); assert.deepEqual(states, ['online', 'offline']);
});
test('a late handshake cannot overwrite a newer event', async () => {
  const states = []; let listener, resolve;
  subscribeState(state => states.push(state), cb => { listener = cb; }, () => new Promise(r => { resolve = r; }));
  listener('online'); resolve('connecting'); await Promise.resolve();
  assert.deepEqual(states, ['online']);
});
test('a failed handshake does not prevent subsequent state events', async () => {
  const states = []; let listener;
  subscribeState(state => states.push(state), cb => { listener = cb; }, async () => { throw new Error('disconnected'); });
  await Promise.resolve(); await Promise.resolve();
  listener('online'); assert.deepEqual(states, ['online']);
});
