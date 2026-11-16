import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSdkAdapter } from '../src/index.ts';

const result = { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null, cache_creation_input_tokens: null }, total_cost_usd: 0.001 };

test('starts a turn, saves the native ID and resumes the next turn', async () => {
  const calls = []; const native = [];
  const adapter = new ClaudeSdkAdapter({
    onNativeId: (_, id) => native.push(id),
    query: ({ prompt, options }) => {
      calls.push({ prompt, options });
      return (async function* () {
        yield { type: 'system', subtype: 'init', claude_code_version: 'test', session_id: 'native-1' };
        yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'answer' }] } };
        yield result;
      })();
    },
  });
  const handle = await adapter.start({ cwd: '/repo', mode: 'default' });
  const events = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'hello' });
  const received = [];
  while (!received.some((event) => event.kind === 'turn_end')) received.push((await events.next()).value);
  assert.deepEqual(received.map((e) => e.kind), ['turn_start', 'agent_version', 'text', 'usage', 'turn_end']);
  assert.deepEqual(native, ['native-1']);
  assert.equal(calls[0].options.resume, undefined);
  // Let the stream finish after its result before sending another prompt.
  await new Promise((resolve) => setImmediate(resolve));
  await adapter.prompt(handle, { text: 'again' });
  while ((await events.next()).value.kind !== 'turn_end') { /* consume */ }
  assert.equal(calls[1].options.resume, 'native-1');
  await adapter.dispose(handle);
});

test('forwards approval and rejects unknown options', async () => {
  let permissionResult;
  const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
    const controller = new AbortController();
    permissionResult = await options.canUseTool('Bash', { command: 'echo ok' }, { signal: controller.signal, toolUseID: 'tool-1', title: 'Run command?' });
    yield result;
  })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'run' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  const approval = (await stream.next()).value;
  assert.equal(approval.title, 'Run command?');
  await assert.rejects(adapter.approve(handle, approval.request, 'always'), /Unknown approval/);
  await adapter.approve(handle, approval.request, 'deny');
  assert.equal((await stream.next()).value.kind, 'approval_decision');
  assert.deepEqual(permissionResult, { behavior: 'deny', message: 'Denied by user' });
  await adapter.dispose(handle);
});

test('rejects unsafe permission modes and reports unexpected stream termination', async () => {
  const adapter = new ClaudeSdkAdapter({ query: () => (async function* () {})() });
  await assert.rejects(adapter.start({ cwd: '/repo', mode: 'bypassPermissions' }), /unsafe/);
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'hello' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.deepEqual((await stream.next()).value, { kind: 'interrupted', reason: 'sdk_stream_ended' });
  await adapter.dispose(handle);
});

test('disposing a waiting approval denies it and closes the stream', async () => {
  let decision;
  const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
    const controller = new AbortController();
    decision = await options.canUseTool('Bash', { command: 'echo ok' }, { signal: controller.signal, toolUseID: 'tool-1' });
    yield result;
  })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'test' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.kind, 'approval_request');
  await adapter.dispose(handle);
  assert.deepEqual(decision, { behavior: 'deny', message: 'Session disposed', interrupt: true });
  assert.equal((await stream.next()).done, true);
});

test('a prompt is accepted immediately after the previous turn end', async () => {
  let calls = 0;
  const adapter = new ClaudeSdkAdapter({ query: () => (async function* () {
    calls++;
    yield { type: 'system', subtype: 'init', claude_code_version: 'test', session_id: 'native-1' };
    yield result;
  })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'one' });
  while ((await stream.next()).value.kind !== 'turn_end') { /* consume */ }
  await adapter.prompt(handle, { text: 'two' });
  while ((await stream.next()).value.kind !== 'turn_end') { /* consume */ }
  assert.equal(calls, 2);
  await adapter.dispose(handle);
});

test('does not silently start a new native session when an ID is missing', async () => {
  const adapter = new ClaudeSdkAdapter({ query: () => (async function* () { yield result; })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'one' });
  while ((await stream.next()).value.kind !== 'turn_end') { /* consume */ }
  await assert.rejects(adapter.prompt(handle, { text: 'two' }), /native session ID/);
  await adapter.dispose(handle);
});

test('disposing closes an SDK stream that is waiting for output', async () => {
  let close;
  let closed = false;
  const adapter = new ClaudeSdkAdapter({ query: () => ({
    [Symbol.asyncIterator]() { return this; },
    next() { return new Promise((resolve) => { close = resolve; }); },
    close() { closed = true; close({ done: true }); },
  }) });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'one' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  await adapter.dispose(handle);
  assert.equal(closed, true);
  assert.equal((await stream.next()).done, true);
});

test('asks clarifying questions and returns user answers to Claude', async () => {
  let decision;
  const questions = [{ question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'First' }], multiSelect: false }];
  const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
    decision = await options.canUseTool('AskUserQuestion', { questions }, { signal: new AbortController().signal, toolUseID: 'tool-1' });
    yield result;
  })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'test' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  const question = (await stream.next()).value;
  assert.equal(question.kind, 'question_request');
  await assert.rejects(adapter.approve(handle, question.request, 'allow'), /requires answers/);
  await assert.rejects(adapter.answerQuestion(handle, question.request, {}), /every question/);
  await adapter.answerQuestion(handle, question.request, { 'Which?': 'A' });
  assert.equal((await stream.next()).value.kind, 'question_answer');
  assert.deepEqual(decision, { behavior: 'allow', updatedInput: { questions, answers: { 'Which?': 'A' } } });
  await adapter.dispose(handle);
});

test('malformed question requests are denied rather than treated as approvals', async () => {
  let decision;
  const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
    decision = await options.canUseTool('AskUserQuestion', { questions: [] }, { signal: new AbortController().signal, toolUseID: 'tool-1' });
    yield result;
  })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'test' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.match((await stream.next()).value.message, /invalid question/);
  assert.equal(decision.behavior, 'deny');
  await adapter.dispose(handle);
});

test('interrupt denies a pending approval and marks the turn interrupted', async () => {
  let decision;
  const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
    yield { type: 'system', subtype: 'init', claude_code_version: 'test', session_id: 'native-1' };
    decision = await options.canUseTool('Bash', { command: 'echo ok' }, { signal: new AbortController().signal, toolUseID: 'tool-1' });
    yield result;
  })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'test' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.equal((await stream.next()).value.kind, 'agent_version');
  const approval = (await stream.next()).value;
  assert.equal(approval.kind, 'approval_request');
  await adapter.interrupt(handle);
  assert.deepEqual(decision, { behavior: 'deny', message: 'Turn interrupted', interrupt: true });
  assert.deepEqual((await stream.next()).value, { kind: 'interrupted', reason: 'user_abort' });
  await assert.rejects(adapter.approve(handle, approval.request, 'allow'), /no longer pending/);
  await assert.rejects(adapter.interrupt(handle), /no active turn/);
  await adapter.dispose(handle);
});

test('a thrown SDK error does not report a successful turn', async () => {
  const adapter = new ClaudeSdkAdapter({ query: () => (async function* () { throw new Error('SDK failed'); })() });
  const handle = await adapter.start({ cwd: '/repo' });
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  await adapter.prompt(handle, { text: 'test' });
  assert.equal((await stream.next()).value.kind, 'turn_start');
  assert.deepEqual((await stream.next()).value, { kind: 'interrupted', reason: 'sdk_error' });
  assert.deepEqual((await stream.next()).value, { kind: 'error', code: 'unknown', message: 'SDK failed' });
  await assert.rejects(adapter.prompt(handle, { text: 'again' }), /native session ID/);
  await adapter.dispose(handle);
});
