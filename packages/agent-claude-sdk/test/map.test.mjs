import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSdkMessage } from '../src/index.ts';

test('maps completed text, thinking and tool calls without duplicating deltas', () => {
  const result = mapSdkMessage({ type: 'assistant', parent_tool_use_id: null, message: { content: [
    { type: 'text', text: 'hello' }, { type: 'thinking', thinking: 'thinking' },
    { type: 'tool_use', id: 'tool1', name: 'Read', input: { path: 'a' } },
  ] } });
  assert.deepEqual(result.events, [
    { kind: 'text', text: 'hello' }, { kind: 'thinking', text: 'thinking' },
    { kind: 'tool_call', callId: 'tool1', name: 'Read', input: { path: 'a' } },
  ]);
  assert.deepEqual(mapSdkMessage({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hel' } } }).events, [{ kind: 'text_delta', text: 'hel' }]);
});

test('keeps subagent tools but hides their text unless explicitly enabled', () => {
  const message = { type: 'assistant', parent_tool_use_id: 'parent', message: { content: [{ type: 'text', text: 'child' }, { type: 'tool_use', id: '1', name: 'Read', input: {} }] } };
  assert.deepEqual(mapSdkMessage(message).events, [{ kind: 'tool_call', callId: '1', name: 'Read', input: {}, parent: 'parent' }]);
  assert.equal(mapSdkMessage(message, { forwardSubagentText: true }).events[0].text, 'child');
});

test('maps tool failures and preserves native session identity', () => {
  assert.deepEqual(mapSdkMessage({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: '1', is_error: true, content: 'failed' }] } }).events, [{ kind: 'tool_result', callId: '1', status: 'failed', output: 'failed' }]);
  assert.deepEqual(mapSdkMessage({ type: 'system', subtype: 'init', claude_code_version: '2.1.323', session_id: 'native-id' }), { events: [{ kind: 'agent_version', version: '2.1.323' }], nativeId: 'native-id' });
});

test('treats SDK cost as cumulative and maps execution errors', () => {
  const result = mapSdkMessage({ type: 'result', subtype: 'error_max_budget_usd', usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: null, cache_creation_input_tokens: null }, total_cost_usd: 0.12, errors: ['limit'] });
  assert.deepEqual(result.events, [{ kind: 'usage', input: 3, output: 4, costCumulativeUsd: 0.12 }, { kind: 'error', code: 'plan_limit', message: 'limit' }, { kind: 'turn_end' }]);
});
