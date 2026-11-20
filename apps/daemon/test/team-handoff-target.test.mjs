import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, createTeam, setSessionTeam, listQueuedPrompts, unreadTeamMessages } from '@ormicode/session-store';
import { teamMethod } from '../src/team-methods.ts';
import { reserveHandoff } from '../src/handoff-transition.ts';

function fixture(t, retiring) {
  const db = openStore(':memory:'); t.after(() => db.close());
  for (const id of ['parent', 'old', 'live']) createSession(db, { id, machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli', ...(id === 'parent' ? {} : { parent: 'parent' }) });
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' });
  for (const id of ['old', 'live']) setSessionTeam(db, id, 'team');
  if (retiring) t.after(reserveHandoff(db, 'old'));
  else db.prepare('UPDATE sessions SET handed_off = 1 WHERE id = ?').run('old');
  const calls = [], replies = [], errors = [];
  const ctx = { db, record: (...args) => calls.push(args), drainQueue: async session => { calls.push(['drain', session]); return true; },
    teamApprovals: { waiting: () => false }, ensureWorker: () => assert.fail('must not wake the retired worker'), toWorker: () => assert.fail('must not abort the retired worker') };
  const client = { link: { reply: (_id, body) => replies.push(body), replyError: (_id, code, message) => errors.push({ code, message }) } };
  return { db, ctx, calls, replies, errors, client };
}

for (const retiring of [false, true]) test(`team mutations reject ${retiring ? 'in-progress' : 'completed'} handoff targets without accepting lost work`, async t => {
  const { db, ctx, calls, replies, errors, client } = fixture(t, retiring);
  for (const method of ['team.reassign', 'team.cancel', 'team.close', 'team.openPr', 'team.approve', 'team.escalate', 'team.status']) {
    await teamMethod(ctx, client, 'request', method, { actor: 'parent', session: 'old', task: 'new work', wake: true });
    assert.equal(errors.at(-1).code, 'team.invalid'); assert.match(errors.at(-1).message, /handed off/);
  }
  for (const urgent of [false, true]) await teamMethod(ctx, client, 'message', 'team.message', { actor: 'parent', to: 'old', text: 'lost update', urgent });
  await teamMethod(ctx, client, 'stale-actor', 'team.message', { actor: 'old', to: 'live', text: 'stale action' });
  assert.equal(errors.length, 10); assert.deepEqual(replies, []); assert.deepEqual(calls, []);
  assert.deepEqual(listQueuedPrompts(db, 'old'), []); assert.deepEqual(unreadTeamMessages(db, 'old'), []); assert.deepEqual(unreadTeamMessages(db, 'live'), []);
  await teamMethod(ctx, client, 'read', 'team.status', { actor: 'parent', session: 'old' });
  assert.equal(replies.at(-1).session, 'old');
  await teamMethod(ctx, client, 'live-message', 'team.message', { actor: 'parent', to: 'live', text: 'live update' });
  assert.equal(errors.length, 10); assert.ok(replies.at(-1).id);
  assert.equal(unreadTeamMessages(db, 'live')[0].body, 'live update');
});
