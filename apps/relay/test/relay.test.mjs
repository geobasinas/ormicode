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
