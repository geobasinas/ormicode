import { test } from 'node:test';
import assert from 'node:assert/strict';
import { electronPlatform, browserPlatform } from '../src/index.ts';

test('electronPlatform adapts the preload bridge and forwards events and state', async () => {
  const calls = []; let evtCb; let stateCb;
  globalThis.window = { ormi: {
    request: async (m, b) => { calls.push(['request', m, b]); return { type: 'res' }; },
    subscribe: (s, a) => calls.push(['subscribe', s, a]), unsubscribe: s => calls.push(['unsubscribe', s]),
    onEvent: cb => { evtCb = cb; }, onState: cb => { stateCb = cb; },
    tokenGet: async () => 'tok', tokenSet: async t => calls.push(['tokenSet', t]), tokenClear: async () => calls.push(['tokenClear']),
    pair: async a => ({ device: a.code }), unpair: async () => undefined, remote: () => null,
    storageBackend: () => 'gnome_libsecret', hubLabel: () => 'local socket',
    winMin: () => calls.push(['min']), winMax: () => undefined, winClose: () => undefined,
  } };
  try {
    const p = electronPlatform();
    assert.deepEqual([p.kind, p.hubLabel, p.desktop.storageBackend()], ['desktop', 'local socket', 'gnome_libsecret']);
    await p.transport.request('session.list', { archived: false });
    p.transport.subscribe('s_1', 4); p.transport.unsubscribe('s_1');
    assert.equal(await p.tokens.get(), 'tok'); await p.tokens.set('new'); await p.tokens.clear();
    assert.deepEqual(await p.desktop.pair({ relay: 'r', account: 'a', code: '9' }), { device: '9' });
    p.desktop.winMin();
    const frames = []; const states = [];
    p.transport.onEvent = f => frames.push(f); p.transport.onState = s => states.push(s);
    evtCb({ type: 'evt' }); stateCb('online');
    assert.deepEqual([frames.length, states], [1, ['online']]);
    assert.deepEqual(calls, [['request', 'session.list', { archived: false }], ['subscribe', 's_1', 4], ['unsubscribe', 's_1'], ['tokenSet', 'new'], ['tokenClear'], ['min']]);
  } finally { delete globalThis.window; }
});

test('electronPlatform fails clearly without the bridge', () => {
  globalThis.window = {};
  try { assert.throws(() => electronPlatform(), /preload bridge missing/); } finally { delete globalThis.window; }
});

test('browserPlatform is an explicit not-implemented seam', async () => {
  const p = browserPlatform({ relay: 'https://relay.example', account: 'a' });
  assert.deepEqual([p.kind, p.hubLabel], ['web', 'https://relay.example']);
  await assert.rejects(p.transport.request('x'), /not implemented/);
  assert.equal(await p.tokens.get(), undefined);
});
