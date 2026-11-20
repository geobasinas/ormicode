import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCliMessage } from '../src/index.ts';

test('maps tool requests, results and permission denials from CLI output', () => {
  const tool = mapCliMessage({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'call', name: 'Read', input: { file_path: 'a.txt' } }] } });
  const result = mapCliMessage({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: 'data' }] } });
  assert.deepEqual(tool.events, [{ kind: 'tool_call', callId: 'call', name: 'Read', input: { file_path: 'a.txt' } }]);
  assert.deepEqual(result.events, [{ kind: 'tool_result', callId: 'call', status: 'completed', output: 'data' }]);
  assert.deepEqual(mapCliMessage({ type: 'system', subtype: 'permission_denied', message: 'Not allowed' }).events, [{ kind: 'permission_denied', reason: 'Not allowed' }]);
});

test('retains subagent tools but suppresses subagent text and rejects malformed events', () => {
  const out = mapCliMessage({ type: 'assistant', parent_tool_use_id: 'parent', message: { content: [{ type: 'text', text: 'hidden' }, { type: 'tool_use', id: 'nested', name: 'Read', input: {} }] } });
  assert.deepEqual(out.events, [{ kind: 'tool_call', callId: 'nested', name: 'Read', input: {}, parent: 'parent' }]);
  assert.throws(() => mapCliMessage({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'missing-fields' }] } }), /Invalid Claude CLI event/);
});

test('maps structured retry and usage without inventing missing cache values', () => {
  const retry = mapCliMessage({ type: 'system', subtype: 'api_retry', error: 'rate_limit', attempt: 2, retry_delay_ms: 5000 });
  assert.deepEqual(retry.events, [{ kind: 'rate_limited', attempt: 2 }, { kind: 'retry_scheduled', delayMs: 5000 }]);
  const result = mapCliMessage({ type: 'result', subtype: 'error_max_budget_usd', usage: { input_tokens: 1, output_tokens: 2 }, total_cost_usd: 0.1, errors: ['budget'] });
  assert.deepEqual(result.events, [{ kind: 'usage', input: 1, output: 2, costCumulativeUsd: 0.1 }, { kind: 'error', code: 'plan_limit', message: 'budget' }]);
  assert.equal(result.result, 'error');
});

test('labels usage with the main-loop assistant model or the only modelUsage entry', () => {
  const main = mapCliMessage({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-sonnet-4-6-20260217', content: [] } });
  const nested = mapCliMessage({ type: 'assistant', parent_tool_use_id: 'task', message: { model: 'claude-haiku-4-5', content: [] } });
  const synthetic = mapCliMessage({ type: 'assistant', parent_tool_use_id: null, message: { model: '<synthetic>', content: [] } });
  assert.deepEqual([main.model, nested.model, synthetic.model], ['claude-sonnet-4-6-20260217', undefined, undefined]);
  const result = (modelUsage, model) => mapCliMessage({ type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 2 }, total_cost_usd: 0.1, modelUsage }, { model }).events[0].model;
  assert.equal(result({ 'claude-haiku-4-5': {}, 'claude-sonnet-4-6': {} }, main.model), 'claude-sonnet-4-6-20260217');
  assert.equal(result({ 'claude-opus-4-6': {} }), 'claude-opus-4-6');
  assert.equal(result({ 'claude-haiku-4-5': {}, 'claude-sonnet-4-6': {} }), undefined);
});
