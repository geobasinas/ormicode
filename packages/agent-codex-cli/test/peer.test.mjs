import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RpcPeer } from '../src/index.ts';

test('correlates out-of-order responses and ignores late replies', async () => {
  const sent = []; const peer = new RpcPeer({ send: (line) => sent.push(JSON.parse(line)) });
  const a = peer.request('thread/start', {}); const b = peer.request('turn/start', {});
  await peer.receive({ id: sent[1].id, result: { value: 'b' } });
  await peer.receive({ id: sent[0].id, result: { value: 'a' } });
  assert.deepEqual(await a, { value: 'a' }); assert.deepEqual(await b, { value: 'b' });
  await peer.receive({ id: sent[0].id, result: { duplicate: true } });
  peer.close();
});

test('server approval requests fail closed unless explicitly handled', async () => {
  const sent = []; const peer = new RpcPeer({ send: (line) => sent.push(JSON.parse(line)) });
  await peer.receive({ id: 17, method: 'item/commandExecution/requestApproval', params: {} });
  assert.equal(sent[0].error.code, -32601);
  assert.equal('result' in sent[0], false);
  peer.close();
});

test('handles server requests, notifications, timeout and close', async () => {
  const sent = []; const notes = [];
  const peer = new RpcPeer({ send: (line) => sent.push(JSON.parse(line)), onRequest: async () => ({ decision: 'decline' }), onNotification: (method) => notes.push(method) });
  await peer.receive({ method: 'turn/completed', params: {} });
  await peer.receive({ id: 10, method: 'item/commandExecution/requestApproval', params: {} });
  assert.deepEqual(notes, ['turn/completed']);
  assert.deepEqual(sent[0], { id: 10, result: { decision: 'decline' } });
  await assert.rejects(peer.request('slow', {}, 5), /timed out/);
  const pending = peer.request('waiting', {}); peer.close();
  await assert.rejects(pending, /closed/);
});
