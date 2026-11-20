import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsLink, connectRemote, joinRemote } from '../src/index.ts';

class FakeWs {
  sent = []; closed = false;
  constructor(url) { this.url = url; FakeWs.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code = 1000) { this.closed = true; this.onclose?.({ code, reason: '' }); }
  emit(msg) { this.onmessage({ data: JSON.stringify(msg) }); }
}
const res = (id, body = {}) => ({ v: 1, type: 'res', id, ok: true, body });
const evt = (seq) => ({ v: 1, type: 'evt', session: 's_01ARZ3NDEKTSV4RRFFQ69G5FAV', seq, ts: 1, body: { kind: 'text', text: 'x' } });

test('request resolves on its res; subscribe also tells the relay DO', async () => {
  const ws = new FakeWs(); const link = new WsLink(ws);
  const p = link.request('session.subscribe', { session: 's_01ARZ3NDEKTSV4RRFFQ69G5FAV', after: 3 });
  assert.deepEqual(ws.sent[0], { type: 'subscribe', session: 's_01ARZ3NDEKTSV4RRFFQ69G5FAV', after: 3 });
  const req = ws.sent[1];
  assert.equal(req.method, 'session.subscribe');
  ws.emit(res(req.id, { ok: 1 }));
  assert.deepEqual((await p).body, { ok: 1 });
  assert.deepEqual(link.lastSub, { session: 's_01ARZ3NDEKTSV4RRFFQ69G5FAV', after: 3 });
});

test('events are deduped by seq and queue until a handler is set', async () => {
  const ws = new FakeWs(); const link = new WsLink(ws);
  ws.emit(evt(1)); ws.emit(evt(1)); ws.emit(evt(2));
  assert.equal((await link.next()).seq, 1);
  const seen = [];
  link.onFrame = f => seen.push(f.seq);
  ws.emit(evt(2)); ws.emit(evt(3));
  assert.deepEqual(seen, [2, 3]);
});

test('sequence gaps hold later events and replay from the last contiguous cursor only once', async () => {
  const ws = new FakeWs(); const link = new WsLink(ws), seen = [];
  link.onFrame = frame => seen.push(frame.seq);
  const pending = link.request('session.subscribe', { session: evt(1).session, after: 1 });
  ws.emit(res(ws.sent.at(-1).id)); await pending;
  ws.emit(evt(4)); ws.emit(evt(3)); ws.emit(evt(4));
  assert.deepEqual(seen, []);
  assert.equal(ws.sent.filter(frame => frame.type === 'subscribe').length, 1);
  const replay = ws.sent.filter(frame => frame.method === 'session.subscribe');
  assert.equal(replay.length, 2);
  assert.deepEqual(replay[1].body, { session: evt(1).session, after: 1 });
  ws.emit({ ...evt(2), body: { kind: 'approval_request' } });
  assert.deepEqual(seen, [2, 3, 4]);
  ws.emit(evt(2)); ws.emit(evt(3)); ws.emit(evt(4));
  ws.emit(res(replay[1].id)); await Promise.resolve();
  ws.emit(evt(5));
  assert.deepEqual(seen, [2, 3, 4, 5]);
  link.close();
});

test('gap replay failures close the connection for retry instead of skipping the missing event', async () => {
  const ws = new FakeWs(); const link = new WsLink(ws), seen = [];
  link.onFrame = frame => seen.push(frame.seq);
  const pending = link.request('session.subscribe', { session: evt(1).session, after: 10 });
  ws.emit(res(ws.sent.at(-1).id)); await pending;
  ws.emit(evt(11));
  assert.equal(ws.sent.filter(frame => frame.method === 'session.subscribe').length, 1);
  ws.emit(evt(13));
  ws.emit({ v: 1, type: 'err', id: ws.sent.at(-1).id, code: 'daemon.error', message: 'retry' });
  await Promise.resolve();
  assert.equal(link.closed, true);
  assert.deepEqual(seen, [11]);
});

test('a fresh subscription without a cursor replays events seen by the previous renderer', async () => {
  const ws = new FakeWs(); const link = new WsLink(ws);
  const seen = []; link.onFrame = f => seen.push(f.seq);
  ws.emit(evt(2));
  seen.length = 0;
  const pending = link.request('session.subscribe', { session: 's_01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  const req = ws.sent[1];
  ws.emit(evt(1)); ws.emit(evt(2));
  ws.emit(res(req.id, { subscribed: true }));
  await pending;
  assert.deepEqual(seen, [1, 2]);
});

test('relay control messages bypass the parser; invalid frames are dropped', () => {
  const ws = new FakeWs(); const link = new WsLink(ws);
  const relay = []; link.onRelayMessage = m => relay.push(m.type);
  ws.emit({ type: 'authed' });
  ws.onmessage({ data: '{"v":1,"type":"evt"}' });
  assert.deepEqual(relay, ['authed']);
  link.close();
  assert.equal(link.closed, true);
});

test('request times out', async () => {
  const link = new WsLink(new FakeWs());
  await assert.rejects(link.request('daemon.status', {}, 20), /timed out/);
});

test('closing a relay link rejects outstanding requests', async () => {
  const link = new WsLink(new FakeWs());
  const pending = link.request('daemon.status', {});
  link.close();
  await assert.rejects(pending, /relay connection closed/);
});

test('connectRemote authenticates with the token first, then says hello', async () => {
  const prev = globalThis.WebSocket; globalThis.WebSocket = FakeWs;
  try {
    const p = connectRemote({ relayUrl: 'https://relay.example/', account: 'a b', device: 'd_1', token: 'tok' });
    const ws = FakeWs.last;
    assert.equal(ws.url, 'wss://relay.example/connect?account=a%20b');
    ws.onopen();
    assert.deepEqual(ws.sent[0], { type: 'auth', token: 'tok' });
    ws.emit({ type: 'authed' });
    const link = await p;
    assert.deepEqual(ws.sent[1], { v: 1, type: 'hello', role: 'client', proto: 1, device: 'd_1' });
    assert.equal(link.closed, false);
  } finally { globalThis.WebSocket = prev; }
});

test('connectRemote identifies relay auth rejection close codes', async () => {
  const prev = globalThis.WebSocket; globalThis.WebSocket = FakeWs;
  try {
    const p = connectRemote({ relayUrl: 'https://relay.example', account: 'a', device: 'd_1', token: 'bad' });
    const ws = FakeWs.last;
    ws.onopen();
    ws.close(4004);
    await assert.rejects(p, error => error.name === 'RelayAuthError' && error.code === 4004);
  } finally { globalThis.WebSocket = prev; }
});

test('resync replays once directly from the hub, including subscriptions other than the last one', async () => {
  const prev = globalThis.WebSocket; globalThis.WebSocket = FakeWs;
  try {
    const errors = [];
    const connected = connectRemote({ relayUrl: 'https://relay.example', account: 'a', device: 'd_1', token: 'tok' }, error => errors.push(error));
    const ws = FakeWs.last; ws.onopen(); ws.emit({ type: 'authed' });
    const link = await connected;
    for (const session of [evt(1).session, 's_01ARZ3NDEKTSV4RRFFQ69G5FAW']) {
      const pending = link.request('session.subscribe', { session, after: 10 });
      ws.emit(res(ws.sent.at(-1).id)); await pending;
    }
    const count = ws.sent.length;
    ws.emit({ type: 'resync', session: evt(1).session });
    ws.emit({ type: 'resync', session: evt(1).session });
    const replay = ws.sent.slice(count);
    assert.equal(replay.length, 1);
    assert.equal(replay[0].type, 'req');
    assert.deepEqual(replay[0].body, { session: evt(1).session, after: 10 });
    ws.emit(evt(11)); ws.emit(res(replay[0].id));
    await Promise.resolve();
    assert.equal(ws.sent.filter(frame => frame.type === 'subscribe').length, 2);
    ws.emit({ type: 'resync', session: 'missing' });
    assert.match(errors.at(-1), /missing.*resync required/);
    ws.emit({ type: 'resync', session: evt(1).session });
    ws.emit({ v: 1, type: 'err', id: ws.sent.at(-1).id, code: 'session.not_found', message: 'gone' });
    await Promise.resolve();
    assert.equal(errors.at(-1), 'session.not_found');
    link.close();
  } finally { globalThis.WebSocket = prev; }
});

test('joinRemote posts the code and surfaces relay errors', async () => {
  const prev = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://relay.example/join?account=acc');
      assert.deepEqual(JSON.parse(init.body), { code: '1234', name: 'Laptop' });
      return { ok: true, status: 200, json: async () => ({ device: 'd_1', token: 't' }) };
    };
    assert.deepEqual(await joinRemote('https://relay.example/', 'acc', '1234', 'Laptop'), { device: 'd_1', token: 't' });
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'pairing.expired' }) });
    await assert.rejects(joinRemote('https://relay.example', 'acc', '1', 'x'), /pairing.expired/);
  } finally { globalThis.fetch = prev; }
});
