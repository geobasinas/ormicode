import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RpcLineDecoder, MAX_RPC_LINE_BYTES } from '../src/index.ts';
const enc = new TextEncoder();

test('decodes split UTF-8 and multiple JSON-RPC messages', () => {
  const decoder = new RpcLineDecoder();
  const bytes = enc.encode('{"id":1,"method":"initialize","params":{"name":"é"}}\n{"id":1,"result":{}}\n');
  const index = bytes.indexOf(0xc3);
  const frames = [...decoder.push(bytes.slice(0, index + 1)), ...decoder.push(bytes.slice(index + 1))];
  assert.equal(frames.length, 2);
  assert.equal(frames[0].params.name, 'é');
  assert.deepEqual(frames[1].result, {});
  decoder.finish();
});

test('accepts server approval requests and rejects ambiguous frames', () => {
  const decoder = new RpcLineDecoder();
  const [request] = decoder.push(enc.encode('{"id":12,"method":"item/commandExecution/requestApproval","params":{}}\n'));
  assert.equal(request.method, 'item/commandExecution/requestApproval');
  assert.throws(() => new RpcLineDecoder().push(enc.encode('{"id":1,"method":"bad","result":{}}\n')));
  assert.throws(() => new RpcLineDecoder().push(enc.encode('not json\n')));
});

test('rejects oversized and truncated frames', () => {
  const decoder = new RpcLineDecoder();
  assert.throws(() => decoder.push(new Uint8Array(MAX_RPC_LINE_BYTES + 1)), /size limit/);
  const truncated = new RpcLineDecoder(); truncated.push(enc.encode('{"id":1'));
  assert.throws(() => truncated.finish(), /Truncated/);
});
