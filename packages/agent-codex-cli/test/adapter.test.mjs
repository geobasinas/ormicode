import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexCliAdapter } from '../src/index.ts';

const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
const adapter = () => new CodexCliAdapter({ spawn: (_cmd, _args, options) => spawn(process.execPath, [fixture], options) });
async function turn(adapter_, handle, text) {
  const stream = adapter_.events(handle)[Symbol.asyncIterator]();
  await adapter_.prompt(handle, { text });
  const events = [];
  for (;;) { const item = await stream.next(); events.push(item.value); if (item.value.kind === 'turn_end' || item.done) break; }
  return { events, stream };
}

test('CLI adapter starts a thread, runs a turn with deltas and usage, resumes', async () => {
  const a = adapter();
  const handle = await a.start({ cwd: '/repo', model: 'gpt-test-1', effort: 'low', mode: 'workspace-write' });
  const { events } = await turn(a, handle, 'hi');
  assert.deepEqual(events.map((event) => event.kind), ['turn_start', 'text_delta', 'text', 'usage', 'turn_end']);
  const resumed = await a.resume({ id: 'thread-1', cwd: '/repo' });
  await a.dispose(resumed);
  await a.dispose(handle);
});

test('CLI adapter labels usage with the effective model app-server reports', async () => {
  const a = adapter();
  const handle = await a.start({ cwd: '/repo' });
  const stream = a.events(handle)[Symbol.asyncIterator]();
  const usage = async text => {
    await a.prompt(handle, { text });
    for (;;) { const { value } = await stream.next(); if (value.kind === 'usage') return value.model; }
  };
  assert.equal(await usage('hi'), 'gpt-fixture-default');
  assert.equal(await usage('reroute'), 'gpt-safe-1');
  assert.equal(await usage('hi'), 'gpt-fixture-default');
  await a.setModel(handle, 'gpt-test-1');
  assert.equal(await usage('hi'), 'gpt-test-1');
  await a.dispose(handle);
});

test('CLI adapter forwards approvals with destructive flag and resumes the turn', async () => {
  const a = adapter();
  const handle = await a.start({ cwd: '/repo' });
  const stream = a.events(handle)[Symbol.asyncIterator]();
  await a.prompt(handle, { text: 'approve me' });
  let item;
  do { item = await stream.next(); } while (item.value.kind !== 'approval_request');
  assert.equal(item.value.destructive, true);
  assert.equal(item.value.rule, 'rm -rf');
  const request = item.value.request;
  await assert.rejects(a.approve(handle, 'missing', 'accept'), /Unknown approval request/);
  await a.approve(handle, item.value.request, 'accept');
  assert.deepEqual((await stream.next()).value, { kind: 'approval_decision', request, option: 'accept' });
  await assert.rejects(a.approve(handle, request, 'accept'), /Unknown approval request/);
  const kinds = [];
  for (;;) { const next = await stream.next(); kinds.push(next.value.kind); if (next.value.kind === 'turn_end') break; }
  assert.ok(kinds.includes('usage'));
  assert.equal(kinds.includes('approval_decision'), false);
  await a.dispose(handle);
});

test('CLI adapter steers mid-turn, queues when idle, and configures turns', async () => {
  const a = adapter();
  const handle = await a.start({ cwd: '/repo' });
  await a.setModel(handle, 'gpt-test-1');
  await a.setEffort(handle, 'high');
  await a.setOption(handle, 'outputSchema', '{"type":"object"}');
  await assert.rejects(a.setOption(handle, 'outputSchema', 'nope'), /valid JSON/);
  await assert.rejects(a.setOption(handle, 'bogus', 'x'), /Unknown/);
  const stream = a.events(handle)[Symbol.asyncIterator]();
  await a.prompt(handle, { text: 'approve me' });
  let item;
  do { item = await stream.next(); } while (item.value.kind !== 'approval_request');
  await a.steer(handle, { text: 'careful' });
  await a.approve(handle, item.value.request, 'accept');
  for (;;) { const next = await stream.next(); if (next.value.kind === 'turn_end') break; }
  await a.steer(handle, { text: 'queued note' });
  await a.prompt(handle, { text: 'next' });
  const kinds = [];
  for (;;) { const next = await stream.next(); kinds.push(next.value.kind); if (next.value.kind === 'turn_end') break; }
  assert.ok(kinds.includes('text'));
  await a.dispose(handle);
});

test('CLI adapter interrupt and model list', async () => {
  const a = adapter();
  const handle = await a.start({ cwd: '/repo' });
  await a.prompt(handle, { text: 'approve me' });
  await a.interrupt(handle);
  const models = await a.models();
  assert.deepEqual(models, [{ id: 'gpt-test-1', name: 'GPT Test', efforts: ['low', 'high'] }]);
  await a.dispose(handle);
});

for (const text of ['approve me', 'question me']) test(`interrupt expires the pending interaction (${text}) and permits another turn`, async t => {
  const a = adapter(), handle = await a.start({ cwd: '/repo' }); t.after(() => a.dispose(handle));
  const stream = a.events(handle)[Symbol.asyncIterator]();
  await a.prompt(handle, { text });
  let event;
  do { event = (await stream.next()).value; } while (!['approval_request', 'question_request'].includes(event.kind));
  const request = event.request;
  await a.interrupt(handle);
  const events = [];
  do { event = (await stream.next()).value; events.push(event); } while (event.kind !== 'turn_end');
  assert.deepEqual(events.filter(e => e.kind === 'interaction_expired'), [{ kind: 'interaction_expired', request, reason: 'cancelled' }]);
  await assert.rejects(a.approve(handle, request, 'accept'), /Unknown/);
  await assert.rejects(a.answerQuestion(handle, request, { 'Which?': 'A' }), /Unknown/);
  await a.prompt(handle, { text: 'again' });
  do { event = (await stream.next()).value; assert.notEqual(event.kind, 'interaction_expired'); } while (event.kind !== 'turn_end');
});

test('a refused interrupt leaves its approval answerable', async t => {
  const a = adapter(), handle = await a.start({ cwd: '/repo' }); t.after(() => a.dispose(handle));
  const stream = a.events(handle)[Symbol.asyncIterator]();
  await a.prompt(handle, { text: 'interrupt fails' });
  let event;
  do { event = (await stream.next()).value; } while (event.kind !== 'approval_request');
  const request = event.request;
  await assert.rejects(a.interrupt(handle), /interrupt refused/);
  await a.approve(handle, request, 'accept');
  assert.deepEqual((await stream.next()).value, { kind: 'approval_decision', request, option: 'accept' });
  do { event = (await stream.next()).value; assert.notEqual(event.kind, 'interaction_expired'); } while (event.kind !== 'turn_end');
});
