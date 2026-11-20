import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PiCliAdapter, PiCliMapper } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_cmd, args, options) => spawn(process.execPath, [fixture, ...args], options);
async function run(adapter, handle, text) {
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text });
  for await (const event of stream) { events.push(event); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; }
  return events;
}
test('CLI streams text and usage, resumes with --session', async () => {
  let id; const seen = []; const adapter = new PiCliAdapter({ spawn: (cmd, args, options) => { seen.push(args); return fake(cmd, args, options); }, onNativeId: (_, value) => { id = value; } });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'hello');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'text_delta', 'usage', 'text', 'turn_end']);
  assert.equal(seen[0].includes('--session-id'), false);
  assert.equal(seen[0].includes('--'), false);
  assert.equal(seen[0].includes('--session'), false);
  assert.ok(seen[0].includes('--print'));
  assert.equal(seen[0][seen[0].indexOf('--mode') + 1], 'json');
  assert.equal(seen[0].at(-1), 'hello');
  assert.equal(id, 'sess-none');
  const second = await run(adapter, handle, 'again');
  assert.equal(second.at(-1).kind, 'turn_end');
  assert.equal(seen[1][seen[1].indexOf('--session') + 1], id);
  assert.equal(seen[1].includes('--session-id'), false);
  assert.equal(seen[1].includes('--'), false);
  await adapter.dispose(handle);
});
test('CLI fails closed on truncated output and requires recovery', async () => {
  const adapter = new PiCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'broken');
  assert.equal(events.at(-1).kind, 'interrupted');
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.dispose(handle);
});
test('CLI completes a current-Pi stream that ends with agent_end and no agent_settled', async () => {
  const adapter = new PiCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'hello');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'text_delta', 'usage', 'text', 'turn_end']);
  assert.equal(events.some(event => event.reason === 'pi_cli_stream_ended'), false);
  assert.equal((await run(adapter, handle, 'again')).at(-1).kind, 'turn_end');
  await adapter.dispose(handle);
});
test('CLI still completes older streams that end with agent_settled', async () => {
  const adapter = new PiCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'legacy');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'text_delta', 'usage', 'text', 'turn_end']);
  await adapter.dispose(handle);
});
for (const prompt of ['aborted', 'legacy-aborted']) test(`CLI reports aborted runs as user interrupts (${prompt})`, async () => {
  const adapter = new PiCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, prompt);
  assert.equal(events.at(-1).kind, 'interrupted');
  assert.equal(events.at(-1).reason, 'user_abort');
  await adapter.dispose(handle);
});
test('CLI completes a turn that includes a tool call', async () => {
  const adapter = new PiCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'tool');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'tool_call', 'tool_result', 'text_delta', 'usage', 'text', 'turn_end']);
  await adapter.dispose(handle);
});
test('CLI mapper treats agent_end as terminal unless Pi will retry', () => {
  const mapper = new PiCliMapper();
  assert.equal(mapper.map({ type: 'agent_end', messages: [], willRetry: true }).terminal, undefined);
  mapper.map({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } });
  const end = mapper.map({ type: 'agent_end', messages: [] });
  assert.equal(end.terminal, true); assert.equal(end.aborted, false);
  assert.deepEqual(end.events.map(event => event.kind), ['text']);
  assert.deepEqual(mapper.map({ type: 'agent_settled', aborted: false }).events, []);
  assert.throws(() => mapper.map({ type: 'turn_start' }), /after agent_settled/);
  const strict = new PiCliMapper(); strict.map({ type: 'agent_end', messages: [] });
  assert.throws(() => strict.map({ type: 'turn_start' }), /after agent_end/);
});
test('CLI mapper maps retries, compaction and thinking changes', () => {
  const mapper = new PiCliMapper();
  assert.equal(mapper.map({ type: 'auto_retry_start', attempt: 2, delayMs: 1500 }).events[1].delayMs, 1500);
  assert.equal(mapper.map({ type: 'thinking_level_changed', level: 'high' }).events[0].effort, 'high');
  assert.equal(mapper.map({ type: 'compaction_end', reason: 'threshold', result: { summary: 'x' }, aborted: false }).events[0].kind, 'compacted');
});
