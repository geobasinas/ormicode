import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_TOOLS, callTeamTool } from '../src/team-mcp.ts';

test('team MCP wrappers pin actor, map every tool and authorize wait through team.status', async () => {
  assert.equal(TEAM_TOOLS.length, 18);
  for (const tool of TEAM_TOOLS) {
    const calls = [];
    const req = async (method, body) => { calls.push({ method, body }); return { ok: true }; };
    let waited = false;
    await callTeamTool(tool.name, { actor: 'spoof', task: 'task', session: 'child', question: 'Why?', options: ['Yes'], title: 'PR', body: '', request: 'request', option: 'allow', reason: 'safe', text: '', action: 'setState' }, 'self', req, async () => { waited = true; return 'idle'; });
    assert.equal(calls[0].body.actor, 'self');
    assert.ok(calls[0].method.startsWith('team.'));
    assert.equal(waited, tool.name === 'team_wait');
    if (tool.name === 'team_board_read') assert.equal(calls[0].body.action, 'read');
    if (tool.name === 'team_wait') { assert.equal(calls[0].method, 'team.status'); assert.equal(calls[0].body.wake, true); }
    else assert.equal(calls[0].body.wake, undefined);
    if (tool.name === 'team_approve') assert.deepEqual(calls[0], { method: 'team.approve', body: { actor: 'self', session: 'child', request: 'request', option: 'allow', reason: 'safe' } });
    if (tool.name === 'team_escalate') assert.deepEqual(calls[0], { method: 'team.escalate', body: { actor: 'self', session: 'child', request: 'request', reason: 'safe' } });
    if (tool.name === 'team_ask_user') assert.deepEqual(calls[0], { method: 'team.askUser', body: { actor: 'self', question: 'Why?', options: ['Yes'] } });
    if (tool.name === 'team_open_pr') assert.deepEqual(calls[0], { method: 'team.openPr', body: { actor: 'self', session: 'child', title: 'PR', body: '' } });
  }
  await assert.rejects(callTeamTool('team_wait', { session: 'sibling' }, 'child', async () => { throw new Error('team.forbidden'); }, async () => assert.fail('wait must not bypass authorization')), /team.forbidden/);
  await callTeamTool('team_escalate', { session: 'child', request: 'request' }, 'self', async (method, body) => {
    assert.equal(method, 'team.escalate');
    assert.deepEqual(body, { actor: 'self', session: 'child', request: 'request' });
    return { escalated: true };
  });
});

test('team_wait returns terminal states in every mode and only waits for unresolved nonterminal states', async () => {
  for (const until of [undefined, 'idle', 'done', 'approval']) {
    for (const state of ['done', 'failed', 'archived', 'interrupted', 'idle', 'awaiting_approval', 'awaiting_input', 'running', undefined]) {
      const status = { session: 'child', ...(state ? { state } : {}) };
      const mode = until ?? 'idle';
      const settled = ['done', 'failed', 'archived', 'interrupted'].includes(state)
        || (mode === 'approval' ? ['awaiting_approval', 'awaiting_input'].includes(state) : state === 'idle');
      let waited = false;
      const result = await callTeamTool('team_wait', { session: 'child', until, timeoutMs: 50 }, 'parent', async (method, body) => {
        assert.equal(method, 'team.status'); assert.equal(body.wake, true);
        return status;
      }, async (session, requested, timeout) => {
        assert.equal(settled, false, `${state} must return immediately in ${mode} mode`);
        assert.equal(session, 'child'); assert.equal(requested, mode); assert.equal(timeout, 50);
        waited = true; return 'waiting';
      });
      assert.equal(waited, !settled, `${state} in ${mode} mode`);
      assert.equal(result, settled ? JSON.stringify(status) : 'waiting');
    }
    await assert.rejects(callTeamTool('team_wait', { session: 'child', until }, 'parent', async () => {
      throw new Error('team.forbidden');
    }, () => assert.fail('must authorize before waiting')), /team.forbidden/);
  }
});
