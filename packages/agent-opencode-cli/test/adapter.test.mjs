import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OpenCodeCliAdapter, OpenCodeCliMapper } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_cmd, args, options) => spawn(process.execPath, [fixture, ...args], options);
async function run(adapter, handle, text) {
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text });
  for await (const event of stream) { events.push(event); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; }
  return events;
}
test('CLI streams text and usage, stores native ID, and resumes via a new process', async () => {
  const seen = [];
  let id; const adapter = new OpenCodeCliAdapter({ spawn: (cmd, args, options) => { seen.push(args); return fake(cmd, args, options); }, onNativeId: (_, value) => { id = value; } });
  const handle = await adapter.start({ cwd: process.cwd() });
  const first = await run(adapter, handle, 'hello');
  assert.deepEqual(first.map(event => event.kind), ['turn_start', 'text_delta', 'usage', 'text', 'turn_end']);
  assert.equal(id, 'ses_fake');
  assert.deepEqual(seen[0].slice(0, 3), ['run', '--format', 'json']);
  assert.equal(seen[0].includes('--standalone'), false);
  assert.equal(seen[0].includes('--session-id'), false);
  assert.equal(seen[0].includes('--'), false);
  assert.equal(seen[0].at(-1), 'hello');
  const second = await run(adapter, handle, 'again');
  assert.equal(second.at(-1).kind, 'turn_end');
  assert.equal(seen[1][seen[1].indexOf('--session') + 1], 'ses_fake');
  assert.equal(seen[1].at(-1), 'again');
  await adapter.dispose(handle);
});
test('CLI passes model, variant, and agent as documented flags', async () => {
  let seen; const adapter = new OpenCodeCliAdapter({ spawn: (cmd, args, options) => { seen = args; return fake(cmd, args, options); } });
  const handle = await adapter.start({ cwd: process.cwd(), model: 'opencode/tidepool', effort: 'high', mode: 'build' });
  await run(adapter, handle, 'hello');
  assert.equal(seen[seen.indexOf('--model') + 1], 'opencode/tidepool');
  assert.equal(seen[seen.indexOf('--variant') + 1], 'high');
  assert.equal(seen[seen.indexOf('--agent') + 1], 'build');
  assert.equal(seen.includes('opencode/tidepool#high'), false);
  assert.equal(seen.includes('--standalone'), false);
  await adapter.dispose(handle);
});
test('CLI fails closed on malformed output and requires explicit recovery', async () => {
  const adapter = new OpenCodeCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'broken');
  assert.equal(events.at(-1).kind, 'interrupted');
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.dispose(handle);
});
test('CLI mapper pairs tools and reports per-step usage', () => {
  const mapper = new OpenCodeCliMapper();
  const called = mapper.map({ type: 'tool_use', sessionID: 's', part: { type: 'tool', id: 't1', tool: 'read', state: { status: 'running', input: {} } } });
  assert.equal(called.events[0].kind, 'tool_call');
  const done = mapper.map({ type: 'tool_use', sessionID: 's', part: { type: 'tool', id: 't1', tool: 'read', state: { status: 'completed', output: 'x' } } });
  assert.equal(done.events[0].kind, 'tool_result');
  const finish = mapper.map({ type: 'step_finish', sessionID: 's', part: { type: 'step-finish', reason: 'stop', tokens: { input: 9, output: 1, cache: { read: 2 } } } });
  assert.equal(finish.events[0].input, 9);
  assert.equal(finish.stopReason, 'stop');
});
test('CLI completes a turn that includes a tool call', async () => {
  const adapter = new OpenCodeCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'tool');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'tool_call', 'tool_result', 'usage', 'text_delta', 'usage', 'text', 'turn_end']);
  await adapter.dispose(handle);
});
