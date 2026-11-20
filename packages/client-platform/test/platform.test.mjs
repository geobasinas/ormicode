import { test } from 'node:test';
import assert from 'node:assert/strict';
import { electronPlatform, browserPlatform, closeBrowserPlatform } from '../src/index.ts';

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

test('browserPlatform exposes web metadata and backs tokens with its store', async () => {
  const values = { token: undefined, remote: null };
  let onMessage;
  const store = {
    getToken: async () => values.token,
    setToken: async token => { values.token = token; },
    clearToken: async () => { values.token = undefined; },
    getRemote: async () => values.remote,
    setRemote: async remote => { values.remote = remote; },
    clear: async () => { values.token = undefined; values.remote = null; },
  };
  const p = browserPlatform({
    relay: 'https://relay.example', version: '1.2.3', commit: 'abc123',
    deps: { store, locks: { request: () => new Promise(() => undefined) }, channel: () => ({
      addEventListener: (_type, listener) => { onMessage = listener; }, postMessage: () => undefined, close: () => undefined,
    }) },
  });
  try {
    assert.deepEqual([p.kind, p.hubLabel], ['web', 'https://relay.example']);
    assert.deepEqual([p.web.relayUrl, p.web.version, p.web.commit], ['https://relay.example', '1.2.3', 'abc123']);
    assert.equal(await p.tokens.get(), undefined);
    await p.tokens.set('secret-token');
    assert.equal(values.token, 'secret-token');
    assert.equal(await p.tokens.get(), 'secret-token');
    await p.tokens.clear();
    assert.equal(values.token, undefined);
    const primary = [], design = [], other = [];
    p.transport.onEvent = frame => primary.push(frame);
    const unsubscribe = p.transport.subscribeEvents(frame => design.push(frame));
    p.transport.subscribeEvents(frame => other.push(frame));
    p.transport.subscribe('s_design', 0);
    const frame = { v: 1, type: 'evt', session: 's_design', seq: 1, ts: 1, body: { kind: 'design_changed', slug: 'board', revision: 1 } };
    onMessage({ data: { t: 'evt', frame } });
    assert.deepEqual([primary, design, other], [[frame], [frame], [frame]]);
    unsubscribe();
    onMessage({ data: { t: 'evt', frame } });
    assert.deepEqual([primary.length, design.length, other.length], [2, 1, 2]);
  } finally { closeBrowserPlatform(p); }
});
