import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexSdkAdapter, CodexEventMapper } from '../src/index.ts';

const usage = { input_tokens: 5, output_tokens: 2, cached_input_tokens: 1, cache_write_input_tokens: 0, reasoning_output_tokens: 0 };
function client(factory) { return { startThread: factory, resumeThread: (_id, opts) => factory(opts) }; }

test('SDK maps paired commands, text and usage', () => {
  const mapper = new CodexEventMapper();
  const item = { type: 'command_execution', id: 'cmd1', command: 'pwd', aggregated_output: '', status: 'in_progress' };
  assert.equal(mapper.map({ type: 'item.started', item }).events[0].kind, 'tool_call');
  const done = mapper.map({ type: 'item.completed', item: { ...item, aggregated_output: '/tmp', status: 'completed', exit_code: 0 } });
  assert.deepEqual(done.events[0], { kind: 'tool_result', callId: 'cmd1', status: 'completed', output: { text: '/tmp', exitCode: 0 } });
  assert.equal(mapper.map({ type: 'item.completed', item: { type: 'agent_message', id: 'a', text: 'hello' } }).events[0].text, 'hello');
  assert.equal(mapper.map({ type: 'turn.completed', usage }).terminal, true);
});

test('SDK adapter runs isolated turns and records a native thread ID', async () => {
  const options = []; const ids = [];
  const adapter = new CodexSdkAdapter({ onNativeId: (_, id) => ids.push(id), client: client((opts) => {
    options.push(opts);
    return { runStreamed: async () => ({ events: (async function* () {
      yield { type: 'thread.started', thread_id: 'thread-1' };
      yield { type: 'turn.started' };
      yield { type: 'item.completed', item: { type: 'agent_message', id: 'a', text: 'hello' } };
      yield { type: 'turn.completed', usage };
    })() }) };
  }) });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'hello' });
  const events = [];
  for (;;) { const item = await stream.next(); events.push(item.value); if (item.value.kind === 'turn_end') break; }
  assert.deepEqual(events.map((e) => e.kind), ['turn_start', 'text', 'usage', 'turn_end']);
  assert.deepEqual(ids, ['thread-1']);
  assert.equal(options[0].approvalPolicy, 'never');
  assert.equal(options[0].sandboxMode, 'read-only');
  await adapter.dispose(handle);
});

test('SDK adapter reports ended streams as interrupted and rejects unsafe modes', async () => {
  const adapter = new CodexSdkAdapter({ client: client(() => ({ runStreamed: async () => ({ events: (async function* () {})() }) })) });
  await assert.rejects(adapter.start({ cwd: '/repo', mode: 'danger-full-access' }), /unsafe/);
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'hello' });
  assert.deepEqual((await stream.next()).value, { kind: 'interrupted', reason: 'sdk_stream_ended' });
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.dispose(handle);
});

test('SDK rejects repeated tool completions', () => {
  const mapper = new CodexEventMapper();
  const item = { type: 'command_execution', id: 'cmd', command: 'pwd', aggregated_output: '', status: 'completed' };
  assert.deepEqual(mapper.map({ type: 'item.completed', item }).events.map((event) => event.kind), ['tool_call', 'tool_result']);
  assert.throws(() => mapper.map({ type: 'item.completed', item }), /Duplicate/);
});

test('SDK stops at fatal stream errors and requires recovery', async () => {
  const adapter = new CodexSdkAdapter({ client: client(() => ({ runStreamed: async () => ({ events: (async function* () {
    yield { type: 'thread.started', thread_id: 'thread-1' };
    yield { type: 'turn.started' };
    yield { type: 'error', message: 'connection failed' };
    yield { type: 'turn.completed', usage };
  })() }) })) });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'hello' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.kind, 'error');
  assert.equal((await stream.next()).value.kind, 'interrupted');
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.dispose(handle);
});

test('SDK stages prompt images as local_image items and turns options into TurnOptions', async () => {
  const inputs = []; const turns = [];
  const adapter = new CodexSdkAdapter({ client: client(() => ({ runStreamed: async (input, opts) => {
    inputs.push(input); turns.push(opts);
    return { events: (async function* () {
      yield { type: 'thread.started', thread_id: 't' }; yield { type: 'turn.started' };
      yield { type: 'turn.completed', usage };
    })() };
  } })) });
  const handle = await adapter.start({ cwd: '/repo' });
  await assert.rejects(adapter.setOption(handle, 'outputSchema', '{bad'), /valid JSON/);
  await assert.rejects(adapter.setOption(handle, 'cyberAccessProgram', 'nope'), /cyberAccessProgram/);
  await assert.rejects(adapter.setOption(handle, 'mystery', 'x'), /Unknown Codex option/);
  await adapter.setOption(handle, 'outputSchema', '{"type":"object"}');
  await adapter.setOption(handle, 'cyberAccessProgram', 'daybreak_blue');
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'look', images: [{ data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }] });
  for (;;) { const item = await stream.next(); if (item.value.kind === 'turn_end') break; }
  assert.equal(Array.isArray(inputs[0]), true);
  assert.equal(inputs[0][0].type, 'local_image');
  assert.equal(inputs[0][1].text, 'look');
  assert.deepEqual(turns[0].outputSchema, { type: 'object' });
  assert.equal(turns[0].cyberAccessProgram, 'daybreak_blue');
  await adapter.dispose(handle);
});
