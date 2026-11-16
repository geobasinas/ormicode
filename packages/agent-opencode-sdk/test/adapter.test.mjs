import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OpenCodeSdkAdapter, OpenCodeEventMapper } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const fake = (_cmd, _args, options) => spawn(process.execPath, [fixture], options);
async function run(adapter, handle, text) {
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text });
  for await (const event of stream) { events.push(event); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; }
  return events;
}
test('SDK streams text and usage over server events and finishes the turn', async () => {
  let id; const adapter = new OpenCodeSdkAdapter({ spawn: fake, onNativeId: (_, value) => { id = value; } });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'hello');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'text_delta', 'text', 'usage', 'turn_end']);
  assert.equal(id, 'ses_fake');
  await adapter.close();
});
test('SDK lists models and applies model and mode changes while idle', async () => {
  const adapter = new OpenCodeSdkAdapter({ spawn: fake });
  const models = await adapter.models();
  assert.equal(models[0].id, 'prov/model-1');
  assert.deepEqual(models[0].efforts, ['low', 'high']);
  const handle = await adapter.start({ cwd: process.cwd() });
  const stream = adapter.events(handle);
  await adapter.setModel(handle, 'prov/model-1');
  await adapter.setMode(handle, 'build');
  const first = await stream[Symbol.asyncIterator]().next();
  await adapter.dispose(handle);
  assert.ok(first.value.kind === 'model_changed' || first.value.kind === 'mode_changed');
  await adapter.close();
});
test('SDK routes a permission ask to the owner and replies verbatim', async () => {
  const adapter = new OpenCodeSdkAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text: 'approval' });
  for await (const event of stream) {
    events.push(event);
    if (event.kind === 'approval_request') await adapter.approve(handle, event.request, 'reject');
    if (event.kind === 'turn_end' || event.kind === 'interrupted') break;
  }
  assert.equal(events.at(-1).kind, 'turn_end');
  assert.ok(events.some(event => event.kind === 'approval_decision' && event.option === 'reject'));
  await adapter.close();
});
test('SDK interruption surfaces as an interrupted turn', async () => {
  const adapter = new OpenCodeSdkAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text: 'wait' });
  await adapter.interrupt(handle);
  for await (const event of stream) { events.push(event); if (event.kind === 'interrupted') break; }
  assert.equal(events.at(-1).reason, 'user_abort');
  await adapter.close();
});
test('SDK marks failed turns for recovery', async () => {
  const adapter = new OpenCodeSdkAdapter({ spawn: fake });
  const handle = await adapter.start({ cwd: process.cwd() });
  const events = await run(adapter, handle, 'fail');
  assert.ok(events.some(event => event.kind === 'error'));
  assert.equal(events.at(-1).kind, 'interrupted');
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.close();
});
test('SDK mapper pairs tool calls with names and results', () => {
  const mapper = new OpenCodeEventMapper('s1');
  const input = mapper.map({ type: 'session.tool.input.started', data: { sessionID: 's1', id: 't1', name: 'read' } });
  assert.deepEqual(input, []);
  const called = mapper.map({ type: 'session.tool.called', data: { sessionID: 's1', id: 't1', input: { path: '.' } } });
  assert.equal(called[0].kind, 'tool_call');
  assert.equal(called[0].name, 'read');
  const done = mapper.map({ type: 'session.tool.success', data: { sessionID: 's1', id: 't1', content: [{ type: 'text', text: 'ok' }] } });
  assert.equal(done[0].kind, 'tool_result');
  assert.deepEqual(mapper.map({ type: 'session.text.delta', data: { sessionID: 'other', delta: 'x' } }), []);
});
