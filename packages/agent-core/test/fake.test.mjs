import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAdapter, NO_CAPABILITIES, validateCapabilities } from '../src/index.ts';
import { parseEventBody } from '@ormicode/protocol';

test('fake adapter emits a valid deterministic turn and closes', async () => {
  const adapter = new FakeAdapter();
  const handle = await adapter.start({ cwd: '/test' });
  await adapter.prompt(handle, { text: 'hello' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  const events = [(await stream.next()).value, (await stream.next()).value, (await stream.next()).value];
  assert.deepEqual(events, [{ kind: 'turn_start' }, { kind: 'text', text: 'hello' }, { kind: 'turn_end' }]);
  for (const event of events) assert.equal(parseEventBody(event).success, true);
  const pending = stream.next();
  await adapter.dispose(handle);
  assert.equal((await pending).done, true);
  await adapter.dispose(handle);
  await assert.rejects(adapter.prompt(handle, { text: 'late' }), /disposed/);
});

test('fake adapter can expose configured commands for composer previews', async () => {
  const previous = process.env.ORMICODE_FAKE_COMMANDS;
  process.env.ORMICODE_FAKE_COMMANDS = JSON.stringify([{ name: 'review', description: 'Review the current changes' }]);
  try {
    const adapter = new FakeAdapter();
    const handle = await adapter.start({ cwd: '/test' });
    assert.deepEqual(await adapter.commands(handle), [{ name: 'review', description: 'Review the current changes', source: 'agent' }]);
    await adapter.dispose(handle);
  } finally {
    if (previous === undefined) delete process.env.ORMICODE_FAKE_COMMANDS;
    else process.env.ORMICODE_FAKE_COMMANDS = previous;
  }
});

test('sessions are isolated and capability claims require implementations', async () => {
  const adapter = new FakeAdapter();
  const one = await adapter.start({ cwd: '/one' });
  const two = await adapter.start({ cwd: '/two' });
  const stream = adapter.events(two)[Symbol.asyncIterator]();
  await adapter.prompt(one, { text: 'first' });
  await adapter.prompt(two, { text: 'second' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.text, 'second');
  assert.deepEqual(validateCapabilities(adapter), []);
  assert.deepEqual(validateCapabilities({ ...adapter, capabilities: { ...NO_CAPABILITIES, steer: true } }), ['steer requires steer']);
  await stream.return();
  await adapter.dispose(one);
  await adapter.dispose(two);
});

test('stopping a pending stream releases the consumer without stopping the session', async () => {
  const adapter = new FakeAdapter();
  const handle = await adapter.start({ cwd: '/test' });
  const first = adapter.events(handle)[Symbol.asyncIterator]();
  const waiting = first.next();
  await assert.rejects(first.next(), /concurrent reads/);
  assert.throws(() => adapter.events(handle), /already has a consumer/);
  await first.return();
  assert.equal((await waiting).done, true);
  const second = adapter.events(handle)[Symbol.asyncIterator]();
  await first.return();
  assert.throws(() => adapter.events(handle), /already has a consumer/);
  await adapter.prompt(handle, { text: 'still alive' });
  assert.equal((await second.next()).value.kind, 'turn_start');
  assert.equal((await second.next()).value.text, 'still alive');
  await second.return();
  await adapter.dispose(handle);
});

test('the fake event buffer has a bounded capacity and rejects the entire turn', async () => {
  const adapter = new FakeAdapter();
  const handle = await adapter.start({ cwd: '/test' });
  for (let i = 0; i < 341; i++) await adapter.prompt(handle, { text: String(i) });
  await assert.rejects(adapter.prompt(handle, { text: 'overflow' }), /buffer is full/);
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  let count = 0;
  await adapter.dispose(handle);
  for await (const event of stream) { assert.ok(event.kind); count++; }
  assert.equal(count, 1023);
});

test('the slow script holds a turn open until interrupted', async () => {
  const adapter = new FakeAdapter({ script: 'slow', delayMs: 60_000 });
  const handle = await adapter.start({ cwd: '/test' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'go' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.kind, 'text_delta');
  await adapter.interrupt(handle);
  assert.deepEqual((await stream.next()).value, { kind: 'interrupted', reason: 'user_abort' });
  await stream.return();
  await adapter.dispose(handle);
});

test('the tool script leaves an interrupted tool result when killed mid-call', async () => {
  const adapter = new FakeAdapter({ script: 'tool', delayMs: 60_000 });
  const handle = await adapter.start({ cwd: '/test' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'ls' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.kind, 'tool_call');
  await adapter.interrupt(handle);
  assert.deepEqual((await stream.next()).value, { kind: 'tool_result', callId: 'call-1', status: 'interrupted' });
  assert.equal((await stream.next()).value.kind, 'interrupted');
  await stream.return();
  await adapter.dispose(handle);
});

test('the tool script completes when the hold elapses', async () => {
  const adapter = new FakeAdapter({ script: 'tool', delayMs: 5 });
  const handle = await adapter.start({ cwd: '/test' });
  await adapter.prompt(handle, { text: 'ls' });
  const kinds = [];
  for await (const event of adapter.events(handle)) { kinds.push(event.kind); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; }
  assert.deepEqual(kinds, ['turn_start', 'tool_call', 'tool_result', 'text', 'turn_end']);
  await adapter.dispose(handle);
});

test('the approval script waits for a decision and forwards it verbatim', async () => {
  const adapter = new FakeAdapter({ script: 'approval', delayMs: 60_000 });
  const handle = await adapter.start({ cwd: '/test' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'rm -rf x' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.kind, 'tool_call');
  const request = (await stream.next()).value;
  assert.equal(request.kind, 'approval_request');
  await adapter.approve(handle, request.request, 'allow');
  assert.equal((await stream.next()).value.kind, 'approval_decision');
  assert.equal((await stream.next()).value.kind, 'tool_result');
  assert.equal((await stream.next()).value.kind, 'turn_end');
  await stream.return();
  await adapter.dispose(handle);
});

test('the ratelimit script reports structured limits and each session gets a native id', async () => {
  const adapter = new FakeAdapter({ script: 'ratelimit' });
  const handle = await adapter.start({ cwd: '/test' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'go' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.kind, 'rate_limited');
  assert.equal((await stream.next()).value.kind, 'retry_scheduled');
  assert.equal(adapter.nativeId(handle), 'fake-native-1');
  await stream.return();
  await adapter.dispose(handle);
});
