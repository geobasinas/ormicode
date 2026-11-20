import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, createTeam, setSessionTeam, getSession, setState, listQueuedPrompts } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { TeamApprovals } from '../src/team-approvals.ts';
import { teamMethod } from '../src/team-methods.ts';
import { stateFor } from '../src/supervisor-state.ts';

test('turn_end expires delegated native approvals and allows team.reassign to queue the replacement', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  for (const id of ['parent', 'child']) {
    createSession(db, { id, parent: id === 'child' ? 'parent' : undefined, machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
    setState(db, id, 'running');
  }
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' }); setSessionTeam(db, 'child', 'team');
  const ctx = { db,
    record(session, kind, payload) {
      [kind, payload] = ctx.teamApprovals.event(session, kind, payload);
      append(db, session, { kind, payload });
      if (stateFor[kind]) setState(db, session, stateFor[kind]);
    },
    async toWorker(session, method) {
      assert.equal(method, 'worker.abort');
      ctx.record(session, 'turn_end', {});
      return { type: 'res' };
    },
    async drainQueue(session) {
      assert.equal(getSession(db, session).state, 'idle');
      assert.equal(ctx.teamApprovals.waiting(session), false);
      return false;
    },
  };
  ctx.teamApprovals = new TeamApprovals(() => ctx, () => true);
  ctx.record('child', 'approval_request', { request: 'request', options: [{ id: 'allow', label: 'Allow once' }] });
  assert.equal(ctx.teamApprovals.waiting('child'), true);
  const replies = [];
  const client = { link: { reply: (id, body) => replies.push(body), replyError: (id, code) => assert.fail(code) } };
  await teamMethod(ctx, client, 'reassign', 'team.reassign', { actor: 'parent', session: 'child', task: 'replacement task' });
  assert.deepEqual(replies, [{ accepted: true }]);
  assert.equal(listQueuedPrompts(db, 'child')[0].text, 'replacement task');
  assert.deepEqual(replay(db, 'child').filter(e => e.kind === 'interaction_expired').map(e => JSON.parse(e.payload)), [{ request: 'request', reason: 'turn_ended' }]);
  assert.deepEqual(ctx.teamApprovals.forParent('parent'), []);
  ctx.record('child', 'turn_start', {});
  ctx.record('child', 'approval_request', { request: 'next', options: [{ id: 'allow', label: 'Allow once' }] });
  assert.equal(ctx.teamApprovals.waiting('child'), true);
});
