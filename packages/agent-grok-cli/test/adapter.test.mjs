import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrokCliAdapter, GrokCliMapper } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_cmd, args, options) => spawn(process.execPath, [fixture, ...args], options);
async function run(adapter, handle, text) {
 const events = []; const stream = adapter.events(handle);
 await adapter.prompt(handle, { text });
 for await (const event of stream) { events.push(event); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; }
 return events;
}
test('CLI streams text and usage, stores native ID, and resumes via a new process', async () => {
 let id; const adapter = new GrokCliAdapter({ spawn: fake, onNativeId: (_, value) => { id = value; } });
 const handle = await adapter.start({ cwd: process.cwd() });
 const first = await run(adapter, handle, 'hello');
 assert.deepEqual(first.map(event => event.kind), ['turn_start', 'text_delta', 'text', 'usage', 'turn_end']);
 assert.equal(id, 'session-1');
 const second = await run(adapter, handle, 'again');
 assert.equal(second.at(-1).kind, 'turn_end');
 await adapter.dispose(handle);
});
test('CLI fails closed on malformed output and requires explicit recovery', async () => {
 const adapter = new GrokCliAdapter({ spawn: fake });
 const handle = await adapter.start({ cwd: process.cwd() });
 const events = await run(adapter, handle, 'broken');
 assert.equal(events.at(-1).kind, 'interrupted');
 await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
 await adapter.dispose(handle);
});
test('CLI mapper pairs tools and counts only terminal usage', () => {
 const mapper = new GrokCliMapper();
 assert.equal(mapper.map({ type: 'tool_call', toolCallId: 't1', toolName: 'read_file', rawInput: {} }).events[0].kind, 'tool_call');
 assert.deepEqual(mapper.map({ type: 'tool_call_update', toolCallId: 't1', status: null }).events, []);
 assert.equal(mapper.map({ type: 'tool_call_update', toolCallId: 't1', status: 'completed' }).events[0].kind, 'tool_result');
 assert.deepEqual(mapper.map({ type: 'tool_call_update', toolCallId: 't1', status: null }).events, []);
 assert.deepEqual(mapper.map({ type: 'usage', usage: { input_tokens: 10 } }).events, []);
 assert.equal(mapper.map({ type: 'end', sessionId: 'x', stopReason: 'end_turn', usage: { input_tokens: 12 } }).events[0].input, 12);
});
test('CLI mapper labels terminal usage with the only reported model', () => {
 const end = modelUsage => new GrokCliMapper().map({ type: 'end', sessionId: 'x', stopReason: 'end_turn', usage: { input_tokens: 12 }, modelUsage }).events[0].model;
 assert.equal(end({ 'grok-4.6': { inputTokens: 12 } }), 'grok-4.6');
 assert.equal(end({ 'grok-4.6': {}, 'grok-code-fast-1': {} }), undefined);
 assert.equal(end({}), undefined);
});
test('CLI stop kills the turn; a resumed adapter continues the official session id', async () => {
 const adapter = new GrokCliAdapter({ spawn: fake });
 const handle = await adapter.start({ cwd: process.cwd() });
 const stream = adapter.events(handle); const kinds = [];
 await adapter.prompt(handle, { text: 'slow' });
 for await (const event of stream) {
  kinds.push(event.kind);
  if (event.kind === 'text_delta') await adapter.interrupt(handle);
  if (event.kind === 'interrupted') { assert.equal(event.reason, 'user_abort'); break; }
 }
 assert.ok(!kinds.includes('turn_end'));
 // The daemon answers this rejection by restarting the worker with resume(), then re-prompting.
 await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
 await adapter.dispose(handle);
 let id; const next = new GrokCliAdapter({ spawn: fake, onNativeId: (_, value) => { id = value; } });
 const resumed = await next.resume({ id: 'native-7', cwd: process.cwd() });
 assert.equal((await run(next, resumed, 'retry')).at(-1).kind, 'turn_end');
 assert.equal(id, 'native-7');
 await next.dispose(resumed);
});
test('CLI models come from `grok models` with names and efforts from the official cache', { skip: process.platform === 'win32' }, async () => {
 const dir = await mkdtemp(join(tmpdir(), 'grok-cli-models-'));
 const executable = join(dir, 'grok');
 await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, { mode: 0o755 });
 await writeFile(join(dir, 'models_cache.json'), JSON.stringify({ models: {
  'grok-4.6': { info: { name: 'Grok 4.6', reasoning_efforts: [{ value: 'low' }, { value: 'high' }] } },
  'grok-hidden': { info: { hidden: true, name: 'Hidden' } },
 } }));
 const previous = process.env.GROK_HOME; process.env.GROK_HOME = dir;
 try {
  assert.deepEqual(await new GrokCliAdapter({ executable }).models(), [
   { id: 'grok-4.6', name: 'Grok 4.6', efforts: ['low', 'high'] },
   { id: 'grok-code-fast-1' },
  ]);
  assert.deepEqual(await new GrokCliAdapter({ executable: join(dir, 'missing') }).models(), []);
 } finally {
  if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous;
  await rm(dir, { recursive: true, force: true });
 }
});
test('CLI mode swaps --always-approve for --permission-mode on the turn process', async () => {
 let args; const adapter = new GrokCliAdapter({ spawn: (_cmd, a, o) => { args = a; return fake(_cmd, a, o); } });
 const handle = await adapter.start({ cwd: process.cwd() });
 await run(adapter, handle, 'hi');
 assert.ok(args.includes('--always-approve'));
 assert.ok(!args.includes('--permission-mode'));
 await adapter.setMode(handle, 'acceptEdits');
 await run(adapter, handle, 'hi');
 assert.ok(!args.includes('--always-approve'));
 assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
 await assert.rejects(adapter.setMode(handle, 'bypassPermissions'), /permission mode/);
 await adapter.dispose(handle);
});
