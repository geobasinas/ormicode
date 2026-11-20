import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, parseRequestBody, parseResponseBody, parseEventBody } from '../src/index.ts';

test('team contracts validate actors, targets, board actions and journal events', () => {
  const actor = newId('s'), child = newId('s'), team = newId('t');
  for (const [method, body] of [
    ['session.askUser', { session: actor, question: 'Why?' }],
    ['team.askUser', { actor, question: 'Proceed?', options: ['Yes', 'No'] }],
    ['team.openPr', { actor, session: child, title: 'Change', body: '', draft: true }],
    ['team.approve', { actor, session: child, request: newId('req'), option: 'allow', reason: 'safe' }],
    ['team.escalate', { actor, session: child, request: newId('req') }],
    ['team.escalate', { actor, session: child, request: newId('req'), reason: '' }],
    ['team.spawn', { actor, task: 'implement' }], ['team.tree', { actor }], ['team.status', { actor, session: child }],
    ['team.message', { actor, to: child, text: 'hello' }], ['team.inbox', { actor }],
    ['team.board', { actor, action: 'append', text: '' }], ['team.cancel', { actor, session: child }],
    ['team.reassign', { actor, session: child, task: 'new task' }], ['team.close', { actor, session: child }],
    ['team.diff', { actor, session: child }], ['team.report', { actor, session: child }],
  ]) assert.equal(parseRequestBody(method, body).success, true, method);
  assert.equal(parseRequestBody('team.spawn', { actor, task: '' }).success, false);
  for (const method of ['team.askUser', 'session.askUser']) {
    assert.equal(parseRequestBody(method, { actor, session: actor, question: '' }).success, false);
    assert.equal(parseResponseBody(method, { request: newId('req'), answers: { 'Why?': 'Because' } }).success, true);
  }
  assert.equal(parseRequestBody('team.openPr', { actor, title: '' }).success, false);
  assert.equal(parseResponseBody('team.openPr', { number: 42, url: 'https://github.com/test/repo/pull/42' }).success, true);
  assert.equal(parseRequestBody('team.spawn', { actor: 'wrong', task: 'task' }).success, false);
  assert.equal(parseRequestBody('team.board', { actor, action: 'replace' }).success, false);
  assert.equal(parseRequestBody('team.cancel', { actor }).success, false);
  assert.equal(parseRequestBody('team.escalate', { actor, session: child }).success, false);
  assert.equal(parseRequestBody('team.escalate', { actor, session: child, request: newId('req'), reason: 42 }).success, false);
  assert.equal(parseResponseBody('team.escalate', { escalated: true }).success, true);
  assert.equal(parseRequestBody('team.approve', { actor, session: child, request: newId('req'), option: 'allow', reason: '' }).success, false);
  assert.equal(parseResponseBody('team.spawn', { team, session: child }).success, true);
  assert.equal(parseResponseBody('team.report', { text: '' }).success, true);
  assert.equal(parseResponseBody('team.inbox', { messages: [] }).success, true);
  assert.equal(parseResponseBody('team.status', { session: child, state: 'idle', lastActivity: 0, tokens: null }).success, true);
  for (const parentless of [false, true]) {
    const status = { session: child, state: 'running', parentless, lastActivity: 0, tokens: null };
    assert.equal(parseResponseBody('team.status', status).data.parentless, parentless);
    assert.equal(parseResponseBody('team.tree', { team, parent: actor, children: [status] }).data.children[0].parentless, parentless);
    const summary = { id: child, title: null, state: 'running', parentless, project: '/repo', vendor: 'fake', transport: 'cli', updatedAt: 0 };
    assert.equal(parseResponseBody('session.list', { sessions: [summary] }).data.sessions[0].parentless, parentless);
    assert.equal(parseResponseBody('session.get', { ...summary, cwd: '/repo', model: null, effort: null }).data.parentless, parentless);
  }
  for (const body of [
    { kind: 'team_pr_result', session: child, branch: 'feature', head: 'abc', number: 42, url: 'https://github.com/test/repo/pull/42' },
    { kind: 'team_parent_changed', parent: actor, parentless: true },
    { kind: 'team_approval_request', parent: actor, request: newId('req'), options: [{ id: 'allow', label: 'Allow' }] },
    { kind: 'agent_spawned', team, child },
    { kind: 'team_message', team, from: actor, to: child, message: newId('q'), quiet: true },
    { kind: 'board_entry', team, actor, action: 'append', text: 'finding' },
  ]) assert.equal(parseEventBody(body).success, true, body.kind);
});
