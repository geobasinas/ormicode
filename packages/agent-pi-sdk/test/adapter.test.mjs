import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PiSdkAdapter, PiSdkMapper } from '../src/index.ts';

function fakeSession(script, id = 'sess-1') {
  const listeners = new Set();
  const session = {
    sessionId: id,
    calls: [],
    pending: null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(event) { for (const listener of listeners) listener(event); },
    async prompt(text) {
      this.calls.push(['prompt', text]);
      for (const event of script(text)) this.emit(event);
      if (this.defer) await new Promise(resolve => { this.pending = resolve; });
    },
    async steer(text) { this.calls.push(['steer', text]); },
    async abort() {
      this.calls.push(['abort']);
      this.emit({ type: 'agent_settled', aborted: true });
      this.pending?.(); this.pending = null;
    },
    async setModel(model) { this.calls.push(['setModel', model]); },
    setThinkingLevel(level) { this.calls.push(['setThinkingLevel', level]); },
    dispose() { this.calls.push(['dispose']); },
  };
  return session;
}
const hello = function* () {
  yield { type: 'agent_start' };
  yield { type: 'turn_start' };
  yield { type: 'message_update', message: { role: 'assistant', usage: { input: 10, output: 4, cost: { total: 0.01 } } }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' } };
  yield { type: 'turn_end', message: { role: 'assistant' }, toolResults: [] };
  yield { type: 'agent_end', messages: [], willRetry: false };
  yield { type: 'agent_settled', aborted: false };
};
async function run(adapter, handle, text) {
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text });
  for await (const event of stream) { events.push(event); if (event.kind === 'turn_end' || event.kind === 'interrupted') break; }
  return events;
}
test('SDK streams a turn and records the native session ID', async () => {
  const created = []; let id;
  const adapter = new PiSdkAdapter({
    create: async options => { created.push(options); return { session: fakeSession(hello) }; },
    onNativeId: (_, value) => { id = value; },
  });
  const handle = await adapter.start({ cwd: '/repo' });
  const events = await run(adapter, handle, 'hello');
  assert.deepEqual(events.map(event => event.kind), ['turn_start', 'text_delta', 'usage', 'text', 'turn_end']);
  assert.equal(id, 'sess-1');
  await adapter.dispose(handle);
});
test('SDK steers, interrupts and changes configuration', async () => {
  const session = fakeSession(function* () { yield { type: 'agent_start' }; yield { type: 'turn_start' }; });
  session.defer = true;
  const adapter = new PiSdkAdapter({ create: async () => ({ session }), resolveModel: async ref => ({ ref }) });
  const handle = await adapter.start({ cwd: '/repo', model: 'prov/m', effort: 'high' });
  const stream = adapter.events(handle);
  const prompting = adapter.prompt(handle, { text: 'hello' });
  await adapter.steer(handle, { text: 'wait' });
  await adapter.interrupt(handle);
  await prompting;
  const events = [];
  for await (const event of stream) { events.push(event); if (event.kind === 'interrupted') break; }
  assert.equal(events.at(-1).reason, 'user_abort');
  assert.deepEqual(session.calls.filter(c => c[0] === 'steer'), [['steer', 'wait']]);
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.dispose(handle);
});
test('SDK applies model and effort while idle and resumes via session manager', async () => {
  const session = fakeSession(hello);
  const opened = [];
  const adapter = new PiSdkAdapter({
    create: async () => ({ session }),
    openSession: async (cwd, id) => { opened.push([cwd, id]); return { kind: 'manager' }; },
    resolveModel: async ref => ({ ref }),
  });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle);
  await adapter.setModel(handle, 'prov/m2');
  await adapter.setEffort(handle, 'high');
  assert.deepEqual(session.calls.filter(c => c[0] === 'setModel'), [['setModel', { ref: 'prov/m2' }]]);
  assert.deepEqual(session.calls.filter(c => c[0] === 'setThinkingLevel'), [['setThinkingLevel', 'high']]);
  await stream[Symbol.asyncIterator]().next();
  await adapter.dispose(handle);
  const resumed = await adapter.resume({ cwd: '/repo', id: 'sess-1' });
  assert.deepEqual(opened, [['/repo', 'sess-1']]);
  await adapter.dispose(resumed);
});
test('SDK marks prompt failures for recovery', async () => {
  const adapter = new PiSdkAdapter({ create: async () => ({ session: fakeSession(function* () { throw new Error('provider down'); }) }) });
  const handle = await adapter.start({ cwd: '/repo' });
  const events = await run(adapter, handle, 'hello');
  assert.equal(events.at(-1).kind, 'interrupted');
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /recovery/);
  await adapter.dispose(handle);
});
test('SDK mapper pairs tool calls and maps retries', () => {
  const mapper = new PiSdkMapper();
  assert.equal(mapper.map({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } }).events[0].kind, 'tool_call');
  assert.equal(mapper.map({ type: 'tool_execution_end', toolCallId: 't1', result: { content: [] }, isError: true }).events[0].status, 'failed');
  assert.equal(mapper.map({ type: 'auto_retry_start', attempt: 1, delayMs: 500 }).events[1].delayMs, 500);
  assert.equal(mapper.map({ type: 'agent_settled', aborted: false }).terminal, true);
});
