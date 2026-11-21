import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAcpAdapter, OpenCodeTurnMapper } from '../src/index.ts';
import { validateTurn } from '@ormicode/agent-core';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_command, _args, options) => {
 assert.equal(options.env, undefined, 'ACP inherits the caller environment; no invented V1 override');
 return spawn(process.execPath, [fixture], options);
};

test('OpenCode ACP adapter streams and completes a turn through its own transport', async () => {
 let nativeId;
 const adapter = new OpenCodeAcpAdapter({ spawn: fake, onNativeId: (_, id) => { nativeId = id; } });
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

test('OpenCode ACP exposes advertised config options and mode choices, and applies them by id', async () => {
 const adapter = new OpenCodeAcpAdapter({ spawn: fake });
 const handle = await adapter.start({ cwd: process.cwd() });
 try {
  assert.deepEqual(adapter.configOptions(handle).map(option => option.id), ['model', 'mode']);
  assert.deepEqual(adapter.modes(handle), [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }]);
  const kinds = [];
  const collecting = (async () => { for await (const event of adapter.events(handle)) { kinds.push(event.kind); if (kinds.length === 2) break; } })();
  await adapter.setMode(handle, 'plan');
  await adapter.setOption(handle, 'model', 'opencode/beam-free');
  await collecting;
  assert.deepEqual(kinds, ['mode_changed', 'config_option']);
  assert.equal(adapter.configOptions(handle).find(option => option.id === 'model').current, 'opencode/beam-free');
  await assert.rejects(adapter.setOption(handle, 'bogus', 'x'), /Unknown OpenCode config option/);
 } finally { await adapter.dispose(handle); }
});

test('OpenCode mapper preserves tool pairing and rejects other sessions', () => {
 const mapper = new OpenCodeTurnMapper('s1');
 const update = (value) => ({ sessionId: 's1', update: value });
 const start = mapper.update(update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read file', status: 'pending', rawInput: { path: 'a' } }));
 const end = mapper.update(update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: 'ok' }));
 assert.equal(start[0].kind, 'tool_call');
 assert.equal(end[0].kind, 'tool_result');
 assert.throws(() => mapper.update({ sessionId: 'other', update: { sessionUpdate: 'plan' } }), /session ID/);
});

test('ACP forwards an explicit denial through the live RPC flow', async () => {
 const adapter = new OpenCodeAcpAdapter({ spawn: fake });
 const handle = await adapter.start({ cwd: process.cwd() });
 try {
  const stream = adapter.events(handle);
  await adapter.prompt(handle, { text: 'approval-test' });
  const events = [];
  for await (const event of stream) {
   events.push(event);
   if (event.kind === 'approval_request') await adapter.approve(handle, event.request, 'deny');
   if (event.kind === 'turn_end' || event.kind === 'interrupted') break;
  }
  assert.equal(events.at(-1).kind, 'turn_end');
  assert.ok(events.some(event => event.kind === 'approval_decision' && event.option === 'deny'));
  assert.ok(events.some(event => event.kind === 'text' && event.text.includes('write blocked')));
 } finally { await adapter.dispose(handle); }
});

test('ACP forwards Allow once without granting a permanent allow rule', async () => {
 const adapter = new OpenCodeAcpAdapter({ spawn: fake });
 const handle = await adapter.start({ cwd: process.cwd() });
 try {
  const stream = adapter.events(handle); const events = [];
  await adapter.prompt(handle, { text: 'approval-allow' });
  for await (const event of stream) {
   events.push(event);
   if (event.kind === 'approval_request') await adapter.approve(handle, event.request, 'allow');
   if (event.kind === 'error' || event.kind === 'interrupted') assert.fail(JSON.stringify(event));
   if (event.kind === 'turn_end') break;
  }
  assert.ok(events.some(event => event.kind === 'text' && event.text.includes('write applied')));
 } finally { await adapter.dispose(handle); }
});

test('ACP permission decisions gate a real fixture file write, including cancellation', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'ormi-opencode-permission-'));
 try {
  for (const choice of ['allow', 'deny', 'cancelled']) {
   const path = join(dir, choice);
   writeFileSync(path, 'original');
   const adapter = new OpenCodeAcpAdapter({ spawn: (_command, args, options) => {
    assert.deepEqual(args, ['acp']);
    assert.equal(options.env, undefined, 'no unsupported configuration is injected');
    return spawn(process.execPath, [fixture], { ...options, env: { ...process.env, ORMI_PERMISSION_TEST_FILE: path } });
   } });
   let handle;
   try {
    handle = await adapter.start({ cwd: dir });
    const stream = adapter.events(handle);
    await adapter.prompt(handle, { text: choice === 'allow' ? 'approval-allow' : choice === 'deny' ? 'approval-test' : 'hello' });
    for await (const event of stream) {
     if (event.kind === 'approval_request') await adapter.approve(handle, event.request, choice);
     if (event.kind === 'error' || event.kind === 'interrupted') assert.fail(JSON.stringify(event));
     if (event.kind === 'turn_end') break;
    }
    assert.equal(readFileSync(path, 'utf8'), choice === 'allow' ? 'approved fixture write' : 'original');
   } finally { if (handle) await adapter.dispose(handle); }
  }
 } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); }
});
