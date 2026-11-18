import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestBody, parseResponseBody, parseEventBody } from '../src/index.ts';

const session = 's_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const machine = 'm_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const request = 'req_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const start = { machine, project: '/repo', vendor: 'fake', transport: 'cli', model: 'default', effort: 'default', mode: 'default', workspace: { kind: 'current' } };

test('session start validates the workspace choice and preserves agent values', () => {
  assert.deepEqual(parseRequestBody('session.start', start), { success: true, data: start });
  assert.equal(parseRequestBody('session.start', { ...start, workspace: { kind: 'worktree', branch: 'main' } }).success, true);
  assert.equal(parseRequestBody('session.start', { ...start, workspace: { kind: 'worktree' } }).success, false);
  assert.equal(parseRequestBody('session.start', { ...start, machine: 'unknown' }).success, false);
});

test('response contracts reject missing fields and unknown methods', () => {
  assert.equal(parseResponseBody('session.start', { session }).success, true);
  assert.equal(parseResponseBody('session.start', {}).success, false);
  assert.equal(parseResponseBody('session.prompt', { accepted: false }).success, false);
  assert.equal(parseResponseBody('session.list', { sessions: [] }).success, true);
  assert.deepEqual(parseResponseBody('session.teleport', {}), { success: false, error: 'protocol.unknown_method' });
});

test('cost totals contracts validate time filters and all aggregation buckets', () => {
  assert.equal(parseRequestBody('cost.totals', {}).success, true);
  assert.equal(parseRequestBody('cost.totals', { since: 0 }).success, true);
  assert.equal(parseRequestBody('cost.totals', { since: -1 }).success, false);
  const bucket = { tokens: 12, usd: null, unpriced: 1, estimate: false };
  const body = {
    total: bucket, projects: [{ project: '/repo', ...bucket }],
    days: [{ date: '2025-01-02', ...bucket }], sessions: [{ session, project: '/repo', ...bucket }],
  };
  assert.equal(parseResponseBody('cost.totals', body).success, true);
  assert.equal(parseResponseBody('cost.totals', { ...body, days: [{ date: 'yesterday', ...bucket }] }).success, false);
});

test('secret listing exposes only names and scope metadata', () => {
  assert.equal(parseRequestBody('secret.list', {}).success, true);
  assert.equal(parseRequestBody('secret.list', { project: '/repo' }).success, true);
  assert.equal(parseResponseBody('secret.list', {
    keyring: 'memory', available: true,
    secrets: [{ name: 'API_KEY', scope: 'project', declared: true, missing: false }],
  }).success, true);
  assert.equal(parseResponseBody('secret.list', {
    keyring: 'memory', available: true,
    secrets: [{ name: 'api-key', scope: 'project', declared: true, missing: false }],
  }).success, false);
});

test('event body contracts check state, text and approval data', () => {
  assert.equal(parseEventBody({ kind: 'text', text: 'hello' }).success, true);
  assert.equal(parseEventBody({ kind: 'text' }).success, false);
  assert.equal(parseEventBody({ kind: 'state', state: 'running' }).success, true);
  assert.equal(parseEventBody({ kind: 'state', state: 'invented' }).success, false);
  assert.equal(parseEventBody({ kind: 'approval_request', request, options: [{ id: 'allow', label: 'Allow' }] }).success, true);
  assert.equal(parseEventBody({ kind: 'approval_decision', request, option: '' }).success, false);
  assert.deepEqual(parseEventBody({ kind: 'unknown' }), { success: false, error: 'protocol.unknown_event' });
  assert.deepEqual(parseEventBody(null), { success: false, error: 'protocol.invalid_frame' });
});

test('agent events require matching tool, usage and retry data', () => {
  const call = { kind: 'tool_call', callId: 'call-1', name: 'read', input: { path: 'a' }, raw: { vendor: true } };
  assert.deepEqual(parseEventBody(call), { success: true, data: call });
  assert.equal(parseEventBody({ kind: 'tool_call', callId: 'call-1', name: 'read' }).success, false);
  assert.equal(parseEventBody({ kind: 'tool_result', callId: 'call-1', status: 'interrupted' }).success, true);
  assert.equal(parseEventBody({ kind: 'usage', input: -1 }).success, false);
  assert.equal(parseEventBody({ kind: 'retry_scheduled', delayMs: -1 }).success, false);
  assert.equal(parseEventBody({ kind: 'text', text: 'ok', raw: undefined }).success, false);
});

test('session controls and notes use matching request and response contracts', () => {
  const note = 'n_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
  assert.equal(parseRequestBody('session.setModel', { session, model: 'model-a' }).success, true);
  assert.equal(parseRequestBody('session.setModel', { session, model: '' }).success, false);
  assert.equal(parseRequestBody('session.setOption', { session, id: 'test', value: true }).success, true);
  assert.equal(parseRequestBody('session.setNotes', { session, id: note, title: 'note', body: 'content' }).success, true);
  assert.equal(parseResponseBody('session.setNotes', { id: note }).success, true);
  assert.equal(parseResponseBody('session.steer', { accepted: true, queued: true }).success, true);
  assert.equal(parseResponseBody('session.steer', { accepted: true }).success, false);
});

test('wire parser checks byte length, JSON and protocol version', async () => {
  const { parseWireFrame, MAX_FRAME_BYTES } = await import('../src/index.ts');
  assert.equal(parseWireFrame(JSON.stringify({ v: 1, type: 'ack', session, seq: 2 })).success, true);
  assert.deepEqual(parseWireFrame('{broken'), { success: false, error: 'protocol.invalid_frame' });
  assert.deepEqual(parseWireFrame('{"v":2}'), { success: false, error: 'protocol.unsupported_version' });
  assert.deepEqual(parseWireFrame('é'.repeat(MAX_FRAME_BYTES / 2 + 1)), { success: false, error: 'protocol.invalid_frame' });
});

test('question contracts preserve vendor presentation fields', () => {
  const body = { kind: 'question_request', request, questions: [{ question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'First', preview: 'example' }], multiSelect: false }] };
  assert.deepEqual(parseEventBody(body), { success: true, data: body });
  assert.equal(parseRequestBody('session.answer', { session, request, answers: { 'Which?': 'A' } }).success, true);
  assert.equal(parseRequestBody('session.answer', { session, request, answers: { 'Which?': '' } }).success, false);
  assert.equal(parseResponseBody('session.answer', { answered: true }).success, true);
});
