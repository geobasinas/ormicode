import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_TOOLS, callTeamTool } from '../src/team-mcp.ts';

test('team MCP wrappers pin actor, map every tool and authorize wait through team.status', async () => {
  assert.equal(TEAM_TOOLS.length, 15);
  for (const tool of TEAM_TOOLS) {
    const calls = [];
    const req = async (method, body) => { calls.push({ method, body }); return { ok: true }; };
    let waited = false;
    await callTeamTool(tool.name, { actor: 'spoof', task: 'task', session: 'child', request: 'request', option: 'allow', reason: 'safe', text: '', action: 'setState' }, 'self', req, async () => { waited = true; return 'idle'; });
    assert.equal(calls[0].body.actor, 'self');
    assert.ok(calls[0].method.startsWith('team.'));
    assert.equal(waited, tool.name === 'team_wait');
    if (tool.name === 'team_board_read') assert.equal(calls[0].body.action, 'read');
    if (tool.name === 'team_wait') assert.equal(calls[0].method, 'team.status');
    if (tool.name === 'team_approve') assert.deepEqual(calls[0], { method: 'team.approve', body: { actor: 'self', session: 'child', request: 'request', option: 'allow', reason: 'safe' } });
  }
  await assert.rejects(callTeamTool('team_wait', { session: 'sibling' }, 'child', async () => { throw new Error('team.forbidden'); }, async () => assert.fail('wait must not bypass authorization')), /team.forbidden/);
});
