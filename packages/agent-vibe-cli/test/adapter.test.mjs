import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VibeCliAdapter, VibeCliMapper } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_cmd, args, options) => spawn(process.execPath, [fixture, ...args], options);
async function run(adapter, handle, text) {
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text });
  for await (const event of stream) { events.push(event); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; }
  return events;
}
test('CLI streams text and usage, stores native ID, and resumes via --resume', async () => {
  let id; let seen; const adapter = new VibeCliAdapter({ spawn: (cmd, args, options) => { seen = args; return fake(cmd, args, options); }, onNativeId: (_, value) => { id = value; } });
  const handle = await adapter.start({ cwd: process.cwd() });
  const first = await run(adapter, handle, 'hello');
  assert.deepEqual(first.map(event => event.kind), ['turn_start', 'text_delta', 'usage', 'text', 'turn_end']);
  assert.equal(id, 'vibe-sess-1');
  const second = await run(adapter, handle, 'again');
  assert.equal(second.at(-1).kind, 'turn_end');
  assert.ok(seen.includes('--resume'));
  await adapter.dispose(handle);
});
test('CLI fails closed on truncated output and requires explicit recovery', async () => {
  const adapter = new VibeCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'broken');
  assert.equal(events.at(-1).kind, 'interrupted');
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.dispose(handle);
});
test('CLI completes a turn that includes a tool call', async () => {
  const adapter = new VibeCliAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'tool');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'tool_call', 'tool_result', 'text_delta', 'usage', 'text', 'turn_end']);
  await adapter.dispose(handle);
});
test('CLI mapper pairs tool blocks with role-tool results', () => {
  const mapper = new VibeCliMapper();
  const call = mapper.map({ type: 'message', role: 'assistant', sessionId: 's', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }] });
  assert.equal(call.events[0].kind, 'tool_call');
  assert.equal(call.nativeId, 's');
  const done = mapper.map({ type: 'message', role: 'tool', sessionId: 's', tool_call_id: 't1', content: 'ok' });
  assert.equal(done.events[0].kind, 'tool_result');
  const end = mapper.map({ type: 'result', sessionId: 's', usage: { prompt_tokens: 8, completion_tokens: 2 }, total_cost_usd: 0.01 });
  assert.equal(end.events[0].input, 8);
  assert.equal(end.terminal, true);
});
