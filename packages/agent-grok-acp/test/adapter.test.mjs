import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GrokAcpAdapter, GrokTurnMapper } from '../src/index.ts';
import { validateTurn } from '@ormicode/agent-core';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_command, _args, options) => spawn(process.execPath, [fixture], options);

test('Grok ACP adapter streams and completes a turn through its own transport', async () => {
 let nativeId;
 const adapter = new GrokAcpAdapter({ spawn: fake, onNativeId: (_, id) => { nativeId = id; } });
 const handle = await adapter.start({ cwd: process.cwd() });
 const stream = adapter.events(handle);
 await adapter.prompt(handle, { text: 'hello' });
 const events = [];
 for await (const event of stream) { events.push(event); if (event.kind === 'turn_end') break; }
 assert.deepEqual(events.map(event => event.kind), ['turn_start', 'text_delta', 'text', 'turn_end']);
 assert.equal(events[2].text, 'hello');
 assert.deepEqual(validateTurn(events), []);
 assert.equal(nativeId, 'session-1');
 await adapter.dispose(handle);
 const resumed = await adapter.resume({ cwd: process.cwd(), id: nativeId });
 await adapter.dispose(resumed);
});

test('Grok mapper preserves tool pairing and rejects other sessions', () => {
 const mapper = new GrokTurnMapper('s1');
 const update = (value) => ({ sessionId: 's1', update: value });
 const start = mapper.update(update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read file', status: 'pending', rawInput: { path: 'a' } }));
 const end = mapper.update(update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: 'ok' }));
 assert.equal(start[0].kind, 'tool_call');
 assert.equal(end[0].kind, 'tool_result');
 assert.throws(() => mapper.update({ sessionId: 'other', update: { sessionUpdate: 'plan' } }), /session ID/);
});

