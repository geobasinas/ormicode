import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPlatform, closeBrowserPlatform } from '../src/index.ts';

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

function environment({ proto = 1, rejectConnect } = {}) {
  const store = memoryStore();
  const locks = new MemoryLocks();
  const links = [];
  const connectCalls = [];
  const connect = async config => {
    connectCalls.push(config);
    if (rejectConnect) throw rejectConnect;
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

test('two tabs share one upstream subscription until both unsubscribe', async t => {
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
  await until(() => env.links[0].calls.filter(([method]) => method === 'session.subscribe').length === 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  first.transport.unsubscribe('s_1');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(env.links[0].calls.filter(([method]) => method === 'session.unsubscribe').length, 0);
  second.transport.unsubscribe('s_1');
  await until(() => env.links[0].calls.filter(([method]) => method === 'session.unsubscribe').length === 1);
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
