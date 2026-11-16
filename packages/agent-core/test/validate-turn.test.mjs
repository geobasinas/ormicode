import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTurn } from '../src/index.ts';

const req = 'req_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
test('recorded turns validate tool calls and approvals', () => {
  const valid = [
    { kind: 'turn_start' },
    { kind: 'tool_call', callId: '1', name: 'shell', input: {} },
    { kind: 'approval_request', request: req, options: [{ id: 'yes', label: 'Allow' }] },
    { kind: 'approval_decision', request: req, option: 'yes' },
    { kind: 'tool_result', callId: '1', status: 'completed' },
    { kind: 'turn_end' },
  ];
  assert.deepEqual(validateTurn(valid), []);
  const invalid = structuredClone(valid);
  invalid[3].option = 'other';
  invalid[4].callId = '2';
  assert.ok(validateTurn(invalid).some((error) => error.includes('unknown approval')));
  assert.ok(validateTurn(invalid).some((error) => error.includes('unknown tool call')));
  assert.ok(validateTurn(invalid).includes('unfinished tool calls'));
});

test('recorded turns reject incomplete, duplicate or unknown events', () => {
  assert.ok(validateTurn([{ kind: 'text', text: 'before' }]).includes('missing turn_end'));
  assert.ok(validateTurn([{ kind: 'turn_start' }, { kind: 'turn_start' }, { kind: 'turn_end' }]).some((e) => e.includes('duplicate')));
  assert.ok(validateTurn([{ kind: 'turn_start' }, { kind: 'invented' }, { kind: 'turn_end' }]).some((e) => e.includes('unknown_event')));
});
