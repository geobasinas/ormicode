import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
