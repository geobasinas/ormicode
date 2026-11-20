import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WsLink, connectRemote, joinRemote } from '../src/index.ts';

class FakeWs {
  sent = []; closed = false;
  constructor(url) { this.url = url; FakeWs.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; this.onclose?.(); }
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
