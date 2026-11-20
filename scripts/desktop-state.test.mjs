import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
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

test('main load-time resend and subscribe handshake share the latest connection state', () => {
  const source = readFileSync(new URL('../apps/desktop/src/main/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const send =');
  const end = source.indexOf('\nfunction loadRemoteFile', start);
  assert.ok(start >= 0 && end > start);
  const replay = source.split('\n').find(line => line.includes("win.webContents.on('did-finish-load'"));
  const snapshot = source.split('\n').find(line => line.includes("ipcMain.handle('ormi:state:get'"));
  assert.ok(replay && snapshot);
  const sent = [];
  const handlers = new Map();
  const webContents = new EventEmitter();
  webContents.send = (channel, payload) => sent.push([channel, payload]);
  const context = {
    win: { isDestroyed: () => false, webContents },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
  const code = `${source.slice(start, end)}\n${replay}\n${snapshot}\nglobalThis.setState = state;`;
  runInNewContext(transformSync(code, { loader: 'ts', format: 'cjs' }).code, context);
  const current = handlers.get('ormi:state:get');
  assert.equal(current(), 'connecting');
  webContents.emit('did-finish-load');
  assert.deepEqual(sent.pop(), ['ormi:state', 'connecting']);
  for (const state of ['online', 'offline', 'connecting', 'online']) {
    context.setState(state);
    assert.equal(current(), state);
    assert.deepEqual(sent.pop(), ['ormi:state', state]);
    webContents.emit('did-finish-load');
    assert.deepEqual(sent.pop(), ['ormi:state', state]);
  }
});
