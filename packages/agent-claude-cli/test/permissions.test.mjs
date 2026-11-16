import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionBroker } from '../src/index.ts';

test('permission broker waits for an explicit decision and preserves the input', async () => {
  const events = []; const broker = new PermissionBroker((event) => events.push(event));
  const input = { command: 'echo ok' };
  const decision = broker.request('Bash', input);
  assert.equal(events[0].kind, 'approval_request');
  input.command = 'changed after request';
  assert.throws(() => broker.decide(events[0].request, 'always'), /Unknown/);
  broker.decide(events[0].request, 'allow');
  assert.deepEqual(await decision, { behavior: 'allow', updatedInput: { command: 'echo ok' } });
  assert.equal(events[1].kind, 'approval_decision');
  assert.throws(() => broker.decide(events[0].request, 'allow'), /not pending/);
});

test('questions require complete answers and keep their original input', async () => {
  const events = []; const broker = new PermissionBroker((event) => events.push(event));
  const questions = [{ question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'First' }], multiSelect: false }];
  const decision = broker.request('AskUserQuestion', { questions });
  const request = events[0].request;
  assert.equal(events[0].kind, 'question_request');
  assert.throws(() => broker.decide(request, 'allow'), /not pending/);
  assert.throws(() => broker.answer(request, {}), /every question/);
  broker.answer(request, { 'Which?': 'A' });
  assert.deepEqual(await decision, { behavior: 'allow', updatedInput: { questions, answers: { 'Which?': 'A' } } });
  assert.equal(events[1].kind, 'question_answer');
});

test('cancellation, disposal and failed delivery deny without hanging', async () => {
  const events = []; const broker = new PermissionBroker((event) => events.push(event));
  const controller = new AbortController();
  const first = broker.request('Bash', {}, controller.signal);
  controller.abort();
  assert.equal((await first).behavior, 'deny');
  assert.equal(events.at(-1).kind, 'interaction_expired');
  const second = broker.request('Write', {});
  broker.dispose();
  assert.equal((await second).behavior, 'deny');
  assert.equal((await broker.request('Read', {})).behavior, 'deny');
  const failing = new PermissionBroker(() => { throw new Error('offline'); });
  assert.equal((await failing.request('Bash', {})).behavior, 'deny');
});

test('invalid input and excessive pending requests fail closed', async () => {
  const broker = new PermissionBroker(() => {});
  assert.equal((await broker.request('Bash', { invalid: undefined })).behavior, 'deny');
  const pending = Array.from({ length: 64 }, () => broker.request('Bash', {}));
  assert.equal((await broker.request('Bash', {})).behavior, 'deny');
  broker.dispose();
  assert.equal((await Promise.all(pending)).every((decision) => decision.behavior === 'deny'), true);
});
