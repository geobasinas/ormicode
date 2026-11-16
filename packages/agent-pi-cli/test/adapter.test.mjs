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
test('CLI streams text and usage, resumes with --session-id', async () => {
  let id; let seen; const adapter = new PiCliAdapter({ spawn: (cmd, args, options) => { seen = args; return fake(cmd, args, options); }, onNativeId: (_, value) => { id = value; } });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'hello');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'text_delta', 'usage', 'text', 'turn_end']);
  assert.ok(seen.includes('--session-id'));
  assert.equal(id, seen[seen.indexOf('--session-id') + 1]);
  const second = await run(adapter, handle, 'again');
  assert.equal(second.at(-1).kind, 'turn_end');
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
test('CLI reports aborted runs as user interrupts', async () => {
  const adapter = new PiCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'aborted');
  assert.equal(events.at(-1).kind, 'interrupted');
  await adapter.dispose(handle);
});
test('CLI completes a turn that includes a tool call', async () => {
  const adapter = new PiCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'tool');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'tool_call', 'tool_result', 'text_delta', 'usage', 'text', 'turn_end']);
  await adapter.dispose(handle);
});
test('CLI mapper maps retries, compaction and thinking changes', () => {
  const mapper = new PiCliMapper();
  assert.equal(mapper.map({ type: 'auto_retry_start', attempt: 2, delayMs: 1500 }).events[1].delayMs, 1500);
  assert.equal(mapper.map({ type: 'thinking_level_changed', level: 'high' }).events[0].effort, 'high');
  assert.equal(mapper.map({ type: 'compaction_end', reason: 'threshold', result: { summary: 'x' }, aborted: false }).events[0].kind, 'compacted');
});
