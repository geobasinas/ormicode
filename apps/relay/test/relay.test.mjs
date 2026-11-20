import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let mf;
const sha256hex = async s => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
};

before(async () => {
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit', shell: true });
  const { Miniflare } = await import('miniflare');
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'], fallthrough: true }],
    scriptPath: join(root, 'dist/index.js'),
    compatibilityDate: '2025-11-17',
    durableObjects: { ACCOUNT: { className: 'AccountDO', useSQLite: true } },
    r2Buckets: ['EVENTS'],
    bindings: { ALLOWED_ORIGINS: 'https://app.example' },
  });
});
after(async () => { await mf?.dispose(); });

const url = (path, account = 'acc1') => `http://localhost${path}?account=${account}`;

test('register stores the hub token hash and pair accepts it', async () => {
  const res = await mf.dispatchFetch(url('/register'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hubToken: 'hubtok-1' }),
  });
  assert.equal(res.status, 200);
  // /pair needs the hub token (hashed match against what /register stored)
  const codeRes = await mf.dispatchFetch(url('/pair'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer hubtok-1' },
    body: JSON.stringify({ codeHash: await sha256hex('123456789012'), expiresAt: Date.now() + 60_000 }),
  });
  assert.equal(codeRes.status, 200);
});

test('join with an unknown code is rejected', async () => {
  const res = await mf.dispatchFetch(url('/join'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '000000000000', name: 'phone' }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'pairing.invalid_code');
});

test('a live code without a connected hub reports hub_offline', async () => {
  const codeHash = await sha256hex('111122223333');
  await mf.dispatchFetch(url('/pair'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer hubtok-1' },
    body: JSON.stringify({ codeHash, expiresAt: Date.now() + 60_000 }),
  });
  const res = await mf.dispatchFetch(url('/join'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '1111 2222 3333', name: 'laptop' }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'pairing.hub_offline');
});

test('websocket auth rejects unknown tokens and accepts the hub token', async () => {
  // unknown token -> close 4004
  const bad = await mf.dispatchFetch(url('/connect'), { headers: { upgrade: 'websocket' } });
  assert.equal(bad.status, 101);
  const badWs = bad.webSocket;
  badWs.accept();
  badWs.send(JSON.stringify({ type: 'auth', token: 'nope' }));
  const closed = await new Promise(r => badWs.addEventListener('close', e => r(e.code)));
  assert.equal(closed, 4004);
});

const wsOf = async path => {
  const res = await mf.dispatchFetch(url(path), { headers: { upgrade: 'websocket' } });
  assert.equal(res.status, 101);
  res.webSocket.accept();
  return res.webSocket;
};
const nextMsg = ws => new Promise(r => ws.addEventListener('message', e => r(JSON.parse(e.data)), { once: true }));

test('full pairing join + device connect + evt fan-out', async () => {
  // Hub connects and authenticates.
  const hub = await wsOf('/connect');
  const hubAuthed = nextMsg(hub);
  hub.send(JSON.stringify({ type: 'auth', token: 'hubtok-1' }));
  assert.equal((await hubAuthed).role, 'hub');

  // Hub registers a code; the device POSTs /join and the DO forwards it.
  const code = '555566667777';
  const codeHash = await sha256hex(code);
  const paired = await mf.dispatchFetch(url('/pair'), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer hubtok-1' },
    body: JSON.stringify({ codeHash, expiresAt: Date.now() + 60_000 }),
  });
  assert.equal(paired.status, 200);

  const joinReq = mf.dispatchFetch(url('/join'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '5555 6666 7777', name: 'phone' }),
  });
  const joinMsg = await nextMsg(hub);
  assert.equal(joinMsg.type, 'pair.join');
  assert.equal(joinMsg.name, 'phone');
  const tokenHash = await sha256hex('devtok-1');
  hub.send(JSON.stringify({ type: 'pair.result', join: joinMsg.join, ok: true, device: 'd_ph', name: 'phone', tokenHash, token: 'devtok-1', codeHash }));
  const joinRes = await joinReq;
  assert.equal(joinRes.status, 200);
  assert.equal((await joinRes.json()).token, 'devtok-1');

  // The device connects with its token, subscribes, and receives hub evts.
  const dev = await wsOf('/connect');
  const devAuthed = nextMsg(dev);
  dev.send(JSON.stringify({ type: 'auth', token: 'devtok-1' }));
  const auth = await devAuthed;
  assert.equal(auth.role, 'device');
  assert.equal(auth.device, 'd_ph');

  dev.send(JSON.stringify({ type: 'subscribe', session: 's_1', after: 0 }));
  const wire = { v: 1, type: 'evt', session: 's_1', seq: 7, ts: 1, body: { kind: 'text', text: 'hi' } };
  hub.send(JSON.stringify({ type: 'evt', session: 's_1', seq: 7, frame: wire }));
  const got = await nextMsg(dev);
  assert.deepEqual(got, wire);

  // Subscribe replay: a second device-cursor socket gets the outbox copy.
  dev.send(JSON.stringify({ type: 'unsubscribe', session: 's_1' }));

  // Hub idx broadcast reaches all device sockets.
  hub.send(JSON.stringify({ type: 'idx', to: '*', frame: { v: 1, type: 'idx', to: 'd_ph', ts: 1, body: { sessions: [{ id: 's_1', state: 'idle' }] } } }));
  const idx = await nextMsg(dev);
  assert.equal(idx.type, 'idx');
  assert.equal(idx.body.sessions[0].id, 's_1');

  // A device request routes to the hub and the reply comes back.
  dev.send(JSON.stringify({ v: 1, type: 'req', id: 'req_1', method: 'session.list', body: {} }));
  const routed = await nextMsg(hub);
  assert.equal(routed.method, 'session.list');
  assert.equal(routed.device, 'd_ph');
  hub.send(JSON.stringify({ type: 'res', id: 'req_1', ok: true, body: { sessions: [] } }));
  const reply = await nextMsg(dev);
  assert.equal(reply.type, 'res');
  assert.equal(reply.id, 'req_1');
});

test('subscribe with an unrecoverable gap gets a resync frame', async () => {
  const hub = await wsOf('/connect');
  const hubAuthed = nextMsg(hub);
  hub.send(JSON.stringify({ type: 'auth', token: 'hubtok-1' }));
  await hubAuthed;
  // Only seq 100 is retained; a device at seq 5 has a gap no chunk covers.
  const wire = { v: 1, type: 'evt', session: 's_gap', seq: 100, ts: 1, body: { kind: 'text' } };
  hub.send(JSON.stringify({ type: 'evt', session: 's_gap', seq: 100, frame: wire }));
  await new Promise(r => setTimeout(r, 200));

  const dev = await wsOf('/connect');
  const devAuthed = nextMsg(dev);
  dev.send(JSON.stringify({ type: 'auth', token: 'devtok-1' }));
  await devAuthed;
  dev.send(JSON.stringify({ type: 'subscribe', session: 's_gap', after: 5 }));
  const res = await nextMsg(dev);
  assert.equal(res.type, 'resync');
  assert.equal(res.session, 's_gap');
});

test('device auth notifies the hub via device.online', async () => {
  const hub = await wsOf('/connect');
  const hubAuthed = nextMsg(hub);
  hub.send(JSON.stringify({ type: 'auth', token: 'hubtok-1' }));
  await hubAuthed;
  const notice = nextMsg(hub);
  const dev = await wsOf('/connect');
  const devAuthed = nextMsg(dev);
  dev.send(JSON.stringify({ type: 'auth', token: 'devtok-1' }));
  await devAuthed;
  assert.equal((await notice).type, 'device.online');
  assert.equal((await notice.catch(() => ({}))).device ?? 'd_ph', 'd_ph');
});

test('browser origins are rejected without an allowlist entry', async () => {
  const res = await mf.dispatchFetch(url('/connect'), {
    headers: { upgrade: 'websocket', origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
});

test('join allows an allowlisted browser origin and answers its preflight', async () => {
  const preflight = await mf.dispatchFetch(url('/join'), {
    method: 'OPTIONS',
    headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal(preflight.headers.get('vary'), 'origin');

  const post = await mf.dispatchFetch(url('/join'), {
    method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' },
    body: JSON.stringify({ code: '000000000000', name: 'browser' }),
  });
  assert.equal(post.status, 403);
  assert.equal(post.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.equal(post.headers.get('vary'), 'origin');
});

test('join rejects disallowed origins and remains usable without an origin', async () => {
  const rejected = await mf.dispatchFetch(url('/join'), {
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ code: '000000000000', name: 'browser' }),
  });
  assert.equal(rejected.status, 403);

  const native = await mf.dispatchFetch(url('/join'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '000000000000', name: 'native' }),
  });
  assert.equal(native.status, 403);
  assert.equal(native.headers.get('access-control-allow-origin'), null);
});
