import test from 'node:test';
import assert from 'node:assert/strict';
import { electronPlatform } from '../src/electron.ts';

for (const early of [false, true]) test(`desktop replays its latest connection state (early=${early})`, t => {
  const previous = globalThis.window;
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  let emit;
  globalThis.window = { ormi: { onEvent() {}, onState(listener) { emit = listener; if (early) emit('connected'); }, hubLabel: () => 'local' } };
  const { transport } = electronPlatform();
  const states = [];
  transport.onState = state => states.push(state);
  assert.deepEqual(states, early ? ['connected'] : []);
  emit('offline'); assert.equal(states.at(-1), 'offline');
  transport.onState = undefined;
  emit('connected');
  const late = [];
  transport.onState = state => late.push(state);
  assert.deepEqual(late, ['connected']);
  assert.equal(states.at(-1), 'offline');
});
