import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, parseRequestBody, parseResponseBody, parseEventBody } from '../src/index.ts';

test('team contracts validate actors, targets, board actions and journal events', () => {
  const actor = newId('s'), child = newId('s'), team = newId('t');
  for (const [method, body] of [
    ['team.spawn', { actor, task: 'implement' }], ['team.tree', { actor }], ['team.status', { actor, session: child }],
    ['team.message', { actor, to: child, text: 'hello' }], ['team.inbox', { actor }],
    ['team.board', { actor, action: 'append', text: '' }], ['team.cancel', { actor, session: child }],
    ['team.reassign', { actor, session: child, task: 'new task' }], ['team.close', { actor, session: child }],
    ['team.diff', { actor, session: child }], ['team.report', { actor, session: child }],
  ]) assert.equal(parseRequestBody(method, body).success, true, method);
  assert.equal(parseRequestBody('team.spawn', { actor, task: '' }).success, false);
  assert.equal(parseRequestBody('team.spawn', { actor: 'wrong', task: 'task' }).success, false);
  assert.equal(parseRequestBody('team.board', { actor, action: 'replace' }).success, false);
  assert.equal(parseRequestBody('team.cancel', { actor }).success, false);
  assert.equal(parseResponseBody('team.spawn', { team, session: child }).success, true);
  assert.equal(parseResponseBody('team.report', { text: '' }).success, true);
  assert.equal(parseResponseBody('team.inbox', { messages: [] }).success, true);
  assert.equal(parseResponseBody('team.status', { session: child, state: 'idle', lastActivity: 0, tokens: null }).success, true);
  for (const body of [
    { kind: 'agent_spawned', team, child },
    { kind: 'team_message', team, from: actor, to: child, message: newId('q'), quiet: true },
    { kind: 'board_entry', team, actor, action: 'append', text: 'finding' },
  ]) assert.equal(parseEventBody(body).success, true, body.kind);
});
