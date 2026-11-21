import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexNotificationMapper } from '../src/index.ts';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const tokenUsage = (last) => ({ threadId: 't', turnId: 'turn-1', tokenUsage: { total: last, last, modelContextWindow: null } });

test('CLI package never mentions the Codex SDK adapter or the official Codex SDK', () => {
  const files = [join(pkg, 'package.json'), ...readdirSync(join(pkg, 'src')).map((name) => join(pkg, 'src', name))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /@ormicode\/agent-codex-sdk|@openai\/codex-sdk/, file);
  }
});

test('mapper maps agent message, reasoning and plan items plus their deltas', () => {
  const m = new CodexNotificationMapper();
  assert.deepEqual(m.map('item/started', { item: { type: 'agentMessage', id: 'a', text: '' } }).events, []);
  assert.deepEqual(m.map('item/agentMessage/delta', { itemId: 'a', delta: 'he' }).events, [{ kind: 'text_delta', text: 'he' }]);
  assert.deepEqual(m.map('item/completed', { item: { type: 'agentMessage', id: 'a', text: 'hello' } }).events, [{ kind: 'text', text: 'hello' }]);
  assert.deepEqual(m.map('item/reasoning/textDelta', { itemId: 'r', delta: 'hm' }).events, [{ kind: 'thinking_delta', text: 'hm' }]);
  assert.deepEqual(m.map('item/completed', { item: { type: 'reasoning', id: 'r', summary: ['one', 'two'], content: [] } }).events, [{ kind: 'thinking', text: 'one\ntwo' }]);
  assert.deepEqual(m.map('item/plan/delta', { itemId: 'p', delta: '- step' }).events, [{ kind: 'text_delta', text: '- step' }]);
  assert.deepEqual(m.map('item/completed', { item: { type: 'plan', id: 'p', text: '- step' } }).events, [{ kind: 'plan', text: '- step' }]);
  assert.deepEqual(m.map('item/completed', { item: { type: 'plan', id: 'p2', items: [{ text: 'a', completed: true }, { text: 'b' }] } }).events, [{ kind: 'plan', text: '[x] a\n[ ] b' }]);
  assert.deepEqual(m.map('item/completed', { item: { type: 'userMessage', id: 'u', content: [] } }).events, []);
});

test('mapper pairs commandExecution, mcpToolCall and fileChange starts with results', () => {
  const m = new CodexNotificationMapper();
  const cmd = { type: 'commandExecution', id: 'c1', command: 'pwd', cwd: '/repo', status: 'inProgress', aggregatedOutput: null, exitCode: null, commandActions: [] };
  assert.deepEqual(m.map('item/started', { item: cmd }).events, [{ kind: 'tool_call', callId: 'c1', name: 'command_execution', input: { command: 'pwd' } }]);
  assert.deepEqual(m.map('item/completed', { item: { ...cmd, status: 'completed', aggregatedOutput: '/repo\n', exitCode: 0 } }).events, [{ kind: 'tool_result', callId: 'c1', status: 'completed', output: { text: '/repo\n', exitCode: 0 } }]);
  assert.throws(() => m.map('item/completed', { item: { ...cmd, status: 'completed' } }), /Duplicate Codex tool completion/);
  // Completion without a start still yields the call first.
  const mcp = { type: 'mcpToolCall', id: 'm1', server: 'docs', tool: 'search', status: 'failed', arguments: { q: 'x' }, result: null, error: { message: 'nope' } };
  assert.deepEqual(m.map('item/completed', { item: mcp }).events, [
    { kind: 'tool_call', callId: 'm1', name: 'mcp_tool_call', input: { server: 'docs', tool: 'search', arguments: { q: 'x' } } },
    { kind: 'tool_result', callId: 'm1', status: 'failed', output: { message: 'nope' } },
  ]);
  const changes = [{ path: 'a.txt', kind: { type: 'add' }, diff: '+a' }];
  assert.equal(m.map('item/started', { item: { type: 'fileChange', id: 'f1', changes, status: 'inProgress' } }).events[0].name, 'file_change');
  assert.deepEqual(m.map('item/completed', { item: { type: 'fileChange', id: 'f1', changes, status: 'declined' } }).events, [{ kind: 'tool_result', callId: 'f1', status: 'failed', output: { changes } }]);
});

test('mapper reports turn start, usage from tokenUsage/updated, rerouted model and turn end', () => {
  const m = new CodexNotificationMapper();
  assert.deepEqual(m.map('thread/started', { thread: { id: 'thread-9' } }), { events: [], nativeId: 'thread-9' });
  assert.deepEqual(m.map('turn/started', { threadId: 'thread-9', turn: { id: 'turn-1', items: [], status: 'inProgress' } }), { events: [{ kind: 'turn_start' }], turnId: 'turn-1' });
  m.map('thread/tokenUsage/updated', tokenUsage({ inputTokens: 5, outputTokens: 2, cachedInputTokens: 1, reasoningOutputTokens: 0, totalTokens: 7 }));
  assert.deepEqual(m.map('turn/completed', { turn: { id: 'turn-1', status: 'completed', error: null } }, 'gpt-a'), {
    events: [{ kind: 'usage', input: 5, output: 2, cacheRead: 1, cacheWrite: 0, model: 'gpt-a' }],
    ended: { turnId: 'turn-1', interrupted: false },
  });
  // Usage and reroute are per turn.
  m.map('model/rerouted', { fromModel: 'gpt-a', toModel: 'gpt-safe', reason: 'highRiskCyberActivity' });
  assert.deepEqual(m.map('turn/completed', { turn: { id: 'turn-2', status: 'completed' } }, 'gpt-a').events, [{ kind: 'usage', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: 'gpt-safe' }]);
  assert.equal(m.map('turn/completed', { turn: { id: 'turn-3', status: 'completed' } }, 'gpt-a').events[0].model, 'gpt-a');
});

test('mapper reports failed and interrupted turns and app-server errors', () => {
  const m = new CodexNotificationMapper();
  assert.deepEqual(m.map('turn/completed', { turn: { id: 't1', status: 'failed', error: { message: 'boom' } } }), { events: [{ kind: 'error', code: 'unknown', message: 'boom' }], ended: { turnId: 't1', interrupted: false } });
  const interrupted = m.map('turn/completed', { turn: { id: 't2', status: 'interrupted', error: null } });
  assert.deepEqual(interrupted.ended, { turnId: 't2', interrupted: true });
  assert.equal(interrupted.events[0].kind, 'usage');
  assert.deepEqual(m.map('error', { error: { message: 'Reconnecting stream' }, willRetry: true }).events, [{ kind: 'state', state: 'retrying', reason: 'Reconnecting stream' }]);
  assert.deepEqual(m.map('error', { error: { message: 'Unrecoverable' }, willRetry: false }).events, [{ kind: 'error', code: 'unknown', message: 'Unrecoverable' }]);
  assert.deepEqual(m.map('some/unknown', {}), { events: [] });
});
