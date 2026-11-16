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
