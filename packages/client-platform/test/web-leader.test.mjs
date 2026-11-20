import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPlatform, closeBrowserPlatform } from '../src/index.ts';
import { WsLink } from '@ormicode/relay-client';
import { newId } from '@ormicode/protocol';
import { bindBrowserLifecycle } from '../../../apps/web/src/lifecycle.ts';

class MemoryLocks {
  queue = [];
  held = false;
  request(_name, options, callback) {
    const signal = typeof options === 'function' ? undefined : options.signal;
    if (typeof options === 'function') callback = options;
    return new Promise((resolve, reject) => {
      const entry = { callback, resolve, reject, signal };
      signal?.addEventListener('abort', () => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('lock request aborted'));
        }
      }, { once: true });
      this.queue.push(entry);
      this.acquire();
    });
  }
  acquire() {
    if (this.held || !this.queue.length) return;
    const entry = this.queue.shift();
    if (entry.signal?.aborted) { entry.reject(new Error('lock request aborted')); this.acquire(); return; }
    this.held = true;
    Promise.resolve().then(entry.callback).then(entry.resolve, entry.reject).finally(() => {
      this.held = false;
      this.acquire();
    });
  }
}

function memoryStore() {
  const data = { token: undefined, remote: null };
  return {
    data,
    getToken: async () => data.token,
    setToken: async token => { data.token = token; },
    clearToken: async () => { data.token = undefined; },
    getRemote: async () => data.remote,
    setRemote: async remote => { data.remote = remote; },
    clear: async () => { data.token = undefined; data.remote = null; },
  };
}

function environment({ proto = 1, rejectConnect, history } = {}) {
  const store = memoryStore();
  const locks = new MemoryLocks();
  const links = [];
  const connectCalls = [];
  const connect = async config => {
    connectCalls.push(config);
    if (rejectConnect) throw rejectConnect;
    if (history) {
      const calls = [];
      const socket = {
        send(raw) {
          const frame = JSON.parse(raw);
          if (frame.type !== 'req') return;
          calls.push([frame.method, frame.body]);
          queueMicrotask(() => {
            if (frame.method === 'session.subscribe') for (const event of history)
              if (event.session === frame.body.session && event.seq > (frame.body.after ?? 0)) socket.onmessage({ data: JSON.stringify(event) });
            socket.onmessage({ data: JSON.stringify({ v: 1, type: 'res', id: frame.id, ok: true, body: frame.method === 'daemon.status' ? { proto } : {} }) });
          });
        },
        close() { socket.onclose({ code: 1000 }); },
      };
      const link = new WsLink(socket); link.calls = calls;
      link.emit = frame => socket.onmessage({ data: JSON.stringify(frame) });
      links.push(link); return link;
    }
    const link = {
      calls: [],
      request: async (method, body) => {
        link.calls.push([method, body]);
        return { v: 1, type: 'res', id: `r_${link.calls.length}`, ok: true, body: method === 'daemon.status' ? proto === null ? {} : { proto } : { sessions: [] } };
      },
      closeCode: undefined,
      close() { this.onClose?.(); },
      onFrame: undefined,
      onClose: undefined,
    };
    links.push(link);
    return link;
  };
  const channelName = `ormicode-${Math.random()}`;
  const deps = {
    store,
    locks,
    channel: () => new BroadcastChannel(channelName),
    connect,
    join: async (_relay, account, code, name) => ({ device: `d_${account}`, token: `token-${code}-${name}` }),
  };
  const platforms = [];
  return {
    store, locks, links, connectCalls, platforms,
    create() {
      const platform = browserPlatform({ relay: 'https://relay.example', version: '0.0.0', commit: 'test', deps });
      platforms.push(platform);
      return platform;
    },
    close() { for (const platform of platforms) closeBrowserPlatform(platform); },
  };
}

async function until(check, message = 'condition not reached') {
  const expires = Date.now() + 3000;
  while (!check() && Date.now() < expires) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check(), message);
}

test('empty IndexedDB store reports unpaired', async t => {
  const env = environment();
  t.after(() => env.close());
  const p = env.create();
  let state;
  p.transport.onState = value => { state = value; };
  await until(() => state === 'unpaired');
  assert.equal(await p.tokens.get(), undefined);
});

test('pairing stores the token and connects the leader online', async t => {
  const env = environment();
  t.after(() => env.close());
  const p = env.create();
  let state;
  p.transport.onState = value => { state = value; };
  await until(() => state === 'unpaired');
  assert.deepEqual(await p.web.pair({ account: 'demo', code: '123456', name: 'browser' }), { device: 'd_demo' });
  await until(() => state === 'online' && env.links.length === 1);
  assert.equal(await p.tokens.get(), 'token-123456-browser');
  assert.deepEqual(await p.web.remote(), { account: 'demo', device: 'd_demo', name: 'browser' });
  assert.deepEqual(env.connectCalls[0], { relayUrl: 'https://relay.example', account: 'demo', device: 'd_demo', token: 'token-123456-browser' });
});

test('a follower request is answered through the leader link', async t => {
  const env = environment();
  t.after(() => env.close());
  const leader = env.create();
  let state;
  leader.transport.onState = value => { state = value; };
  await until(() => state === 'unpaired');
  await leader.web.pair({ account: 'demo', code: '111111' });
  await until(() => state === 'online' && env.links.length === 1);
  const follower = env.create();
  const answer = await follower.transport.request('session.list', { archived: false });
  assert.equal(answer.type, 'res');
  assert.deepEqual(answer.body, { sessions: [] });
  assert.ok(env.links[0].calls.some(([method, body]) => method === 'session.list' && body.archived === false));
});

test('two tabs share a live subscription, replay each tab and unsubscribe only after both leave', async t => {
  const env = environment();
  t.after(() => env.close());
  const first = env.create();
  let state;
  first.transport.onState = value => { state = value; };
  await until(() => state === 'unpaired');
  await first.web.pair({ account: 'demo', code: '222222' });
  await until(() => state === 'online' && env.links.length === 1);
  const second = env.create();
  first.transport.subscribe('s_1', 3);
  second.transport.subscribe('s_1', 3);
  await until(() => env.links[0].calls.filter(([method]) => method === 'session.subscribe').length === 2);
  await new Promise(resolve => setTimeout(resolve, 20));
  first.transport.unsubscribe('s_1');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(env.links[0].calls.filter(([method]) => method === 'session.unsubscribe').length, 0);
  second.transport.unsubscribe('s_1');
  await until(() => env.links[0].calls.filter(([method]) => method === 'session.unsubscribe').length === 1);
});

test('new tabs and reopened sessions receive full history through real WsLink dedup without duplicating existing subscribers', async t => {
  const session = newId('s');
  const history = [1, 2, 3].map(seq => ({ v: 1, type: 'evt', session, seq, ts: seq, body: { kind: 'text', text: String(seq) } }));
  const env = environment({ history }); t.after(() => env.close());
  const first = env.create(), received = [[], []];
  first.transport.onEvent = frame => { if (frame.type === 'evt') received[0].push(frame.seq); };
  await until(() => env.connectCalls.length === 0);
  await first.web.pair({ account: 'demo', code: 'history' });
  await until(() => env.links.length === 1);
  first.transport.subscribe(session);
  await until(() => received[0].length === 3);
  const second = env.create(); second.transport.onEvent = frame => { if (frame.type === 'evt') received[1].push(frame.seq); };
  second.transport.subscribe(session);
  await until(() => received[1].length === 3);
  assert.deepEqual(received, [[1, 2, 3], [1, 2, 3]]);
  first.transport.unsubscribe(session); second.transport.unsubscribe(session);
  await until(() => env.links[0].calls.some(([method]) => method === 'session.unsubscribe'));
  received[0] = []; first.transport.subscribe(session, 0);
  await until(() => received[0].length === 3);
  assert.deepEqual(received[0], [1, 2, 3]); assert.deepEqual(received[1], [1, 2, 3]);
  assert.ok(env.links[0].calls.filter(([method]) => method === 'session.subscribe').every(([, body]) => body.after === undefined));
});

test('the waiting tab takes over and restores its subscriptions after leader close', async t => {
  const env = environment();
  t.after(() => env.close());
  const first = env.create();
  let state;
  first.transport.onState = value => { state = value; };
  await until(() => state === 'unpaired');
  await first.web.pair({ account: 'demo', code: '333333' });
  await until(() => state === 'online' && env.links.length === 1);
  const second = env.create();
  second.transport.subscribe('s_takeover', 7);
  await until(() => env.links[0].calls.some(([method]) => method === 'session.subscribe'));
  closeBrowserPlatform(first);
  await until(() => env.links.length === 2 && env.links[1].calls.some(([method]) => method === 'session.subscribe'));
  assert.equal(env.connectCalls.length, 2);
});

test('relay reconnect and leader takeover resume from delivered events, not the initial cursor', async t => {
  const session = newId('s');
  const event = seq => ({ v: 1, type: 'evt', session, seq, ts: seq, body: { kind: 'text', text: String(seq) } });
  const history = [event(1), event(2)];
  const env = environment({ history }); t.after(() => env.close());
  const first = env.create(), received = [];
  first.transport.onEvent = frame => { if (frame.type === 'evt') received.push(frame.seq); };
  await first.web.pair({ account: 'demo', code: 'resume' });
  await until(() => env.links.length === 1);
  first.transport.subscribe(session);
  await until(() => received.length === 2);
  history.push(event(3)); env.links[0].close();
  await until(() => received.length === 3);
  assert.deepEqual(env.links[1].calls.find(([method]) => method === 'session.subscribe')[1], { session, after: 2 });
  assert.deepEqual(received, [1, 2, 3]);
  const second = env.create(), follower = [];
  second.transport.onEvent = frame => { if (frame.type === 'evt') follower.push(frame.seq); };
  second.transport.subscribe(session);
  await until(() => follower.length === 3);
  closeBrowserPlatform(first);
  await until(() => env.links[2]?.calls.some(([method]) => method === 'session.subscribe'));
  assert.deepEqual(env.links[2].calls.find(([method]) => method === 'session.subscribe')[1], { session, after: 3 });
  assert.deepEqual(follower, [1, 2, 3]); assert.deepEqual(received, [1, 2, 3]);
});

test('reconnect uses the least advanced subscriber cursor', async t => {
  const env = environment(); t.after(() => env.close());
  const first = env.create();
  await first.web.pair({ account: 'demo', code: 'minimum' });
  await until(() => env.links.length === 1);
  first.transport.subscribe('s_minimum', 10);
  const second = env.create(), received = [];
  second.transport.onEvent = frame => received.push(frame.seq);
  second.transport.subscribe('s_minimum');
  await until(() => env.links[0].calls.filter(([method]) => method === 'session.subscribe').length === 2);
  env.links[0].onFrame({ v: 1, type: 'evt', session: 's_minimum', seq: 1, ts: 1, body: { kind: 'text', text: 'first' } });
  await until(() => received.length === 1);
  env.links[0].close();
  await until(() => env.links[1]?.calls.some(([method]) => method === 'session.subscribe'));
  assert.deepEqual(env.links[1].calls.find(([method]) => method === 'session.subscribe')[1], { session: 's_minimum', after: 1 });
});

test('relay gaps recover approvals in order for every tab before advancing reconnect cursors', async t => {
  const session = newId('s');
  const event = seq => ({ v: 1, type: 'evt', session, seq, ts: seq, body: { kind: seq === 2 ? 'approval_request' : 'text', text: String(seq) } });
  const history = [event(1)];
  const env = environment({ history }); t.after(() => env.close());
  const first = env.create(), received = [[], []];
  first.transport.onEvent = frame => received[0].push(frame.seq);
  await first.web.pair({ account: 'demo', code: 'gap' });
  await until(() => env.links.length === 1);
  first.transport.subscribe(session);
  await until(() => received[0].length === 1);
  const second = env.create(); second.transport.onEvent = frame => received[1].push(frame.seq);
  second.transport.subscribe(session);
  await until(() => received[1].length === 1);
  history.push(event(2), event(3));
  env.links[0].emit(event(3));
  assert.deepEqual(received, [[1], [1]]);
  await until(() => received[0].length === 3 && received[1].length === 3);
  assert.deepEqual(received, [[1, 2, 3], [1, 2, 3]]);
  assert.deepEqual(env.links[0].calls.at(-1), ['session.subscribe', { session, after: 1 }]);
  env.links[0].close();
  await until(() => env.links[1]?.calls.some(([method]) => method === 'session.subscribe'));
  assert.deepEqual(env.links[1].calls.find(([method]) => method === 'session.subscribe')[1], { session, after: 3 });
});

test('persisted pageshow reconnects the same platform and listeners on every bfcache restore', async t => {
  const env = environment(); t.after(() => env.close());
  const platform = env.create(), target = new EventTarget(), states = [], received = [];
  t.after(bindBrowserLifecycle(platform, target));
  const transport = platform.transport;
  transport.onState = state => states.push(state);
  transport.onEvent = frame => received.push(frame.seq);
  target.dispatchEvent(new Event('pageshow'));
  await platform.web.pair({ account: 'demo', code: 'bfcache' });
  await until(() => env.links.length === 1 && states.at(-1) === 'online');
  transport.subscribe('s_cache');
  env.links[0].onFrame({ v: 1, type: 'evt', session: 's_cache', seq: 1, ts: 1, body: { kind: 'text', text: 'before' } });
  for (let cycle = 1; cycle <= 2; cycle++) {
    target.dispatchEvent(new Event('pagehide'));
    target.dispatchEvent(new Event('pageshow'));
    assert.equal(env.links.length, cycle);
    const restore = new Event('pageshow'); Object.defineProperty(restore, 'persisted', { value: true });
    target.dispatchEvent(restore);
    await until(() => env.links[cycle]?.calls.some(([method]) => method === 'session.subscribe'));
    assert.equal(platform.transport, transport);
    assert.deepEqual(env.links[cycle].calls.find(([method]) => method === 'session.subscribe')[1], { session: 's_cache', after: cycle });
    env.links[cycle].onFrame({ v: 1, type: 'evt', session: 's_cache', seq: cycle + 1, ts: 1, body: { kind: 'text', text: 'after' } });
    target.dispatchEvent(restore);
    assert.equal(env.links.length, cycle + 1);
    assert.equal((await transport.request('session.list', {})).type, 'res');
  }
  assert.deepEqual(received, [1, 2, 3]); assert.equal(states.at(-1), 'online');
});

test('an unknown or revoked token clears the store and returns to unpaired', async t => {
  const env = environment({ rejectConnect: Object.assign(new Error('unknown token'), { code: 4004 }) });
  t.after(() => env.close());
  const p = env.create();
  const states = [];
  p.transport.onState = value => states.push(value);
  await until(() => states.includes('unpaired'));
  await p.web.pair({ account: 'demo', code: '444444' });
  await until(() => env.connectCalls.length === 1 && states.at(-1) === 'unpaired');
  assert.equal(await p.tokens.get(), undefined);
  assert.equal(await p.web.remote(), null);
});

test('daemon status protocol mismatches select the correct client-side state', async t => {
  for (const [proto, expected] of [[2, 'protocol-old-client'], [0, 'protocol-old-hub'], [null, 'protocol-old-hub']]) {
    const env = environment({ proto });
    try {
      const p = env.create();
      let state;
      p.transport.onState = value => { state = value; };
      await until(() => state === 'unpaired');
      await p.web.pair({ account: 'demo', code: `${proto ?? 'missing'}` });
      await until(() => state === expected, `proto ${proto} expected ${expected}, saw ${state}`);
    } finally { env.close(); }
  }
});
