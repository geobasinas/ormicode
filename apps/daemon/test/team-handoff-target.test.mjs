import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, createTeam, setSessionTeam, listQueuedPrompts, unreadTeamMessages, addTeamMessage, getTeamUserMessage } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { teamMethod } from '../src/team-methods.ts';
import { reserveHandoff } from '../src/handoff-transition.ts';
import { TeamLifecycle } from '../src/team-lifecycle.ts';
import { callTeamTool } from '../src/team-mcp.ts';

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
  for (const method of ['team.reassign', 'team.cancel', 'team.close', 'team.openPr', 'team.approve', 'team.escalate']) {
    await teamMethod(ctx, client, 'request', method, { actor: 'parent', session: 'old', task: 'new work', wake: true });
    assert.equal(errors.at(-1).code, 'team.invalid'); assert.match(errors.at(-1).message, /handed off/);
  }
  for (const urgent of [false, true]) await teamMethod(ctx, client, 'message', 'team.message', { actor: 'parent', to: 'old', text: 'lost update', urgent });
  await teamMethod(ctx, client, 'stale-actor', 'team.message', { actor: 'old', to: 'live', text: 'stale action' });
  assert.equal(errors.length, 9); assert.deepEqual(replies, []); assert.deepEqual(calls, []);
  assert.deepEqual(listQueuedPrompts(db, 'old'), []); assert.deepEqual(unreadTeamMessages(db, 'old'), []); assert.deepEqual(unreadTeamMessages(db, 'live'), []);
  await teamMethod(ctx, client, 'read', 'team.status', { actor: 'parent', session: 'old' });
  assert.equal(replies.at(-1).session, 'old');
  await teamMethod(ctx, client, 'wait', 'team.status', { actor: 'parent', session: 'old', wake: true });
  assert.equal(replies.at(-1).session, 'old'); assert.deepEqual(calls, []);
  await teamMethod(ctx, client, 'live-message', 'team.message', { actor: 'parent', to: 'live', text: 'live update' });
  assert.equal(errors.length, 9); assert.ok(replies.at(-1).id);
  assert.equal(unreadTeamMessages(db, 'live')[0].body, 'live update');
});

test('team_wait reports a retired child as done without waking, waiting or bypassing membership checks', async t => {
  const { db, ctx, client, replies, errors, calls } = fixture(t, false);
  ctx.teamApprovals.waiting = () => true;
  const req = async (method, body) => {
    await teamMethod(ctx, client, 'status', method, body);
    if (errors.length) throw new Error(errors.at(-1).code);
    return replies.at(-1);
  };
  for (const until of [undefined, 'idle', 'done', 'approval']) {
    const result = JSON.parse(await callTeamTool('team_wait', { session: 'old', until }, 'parent', req, () => assert.fail('retired child is already done')));
    assert.equal(result.session, 'old'); assert.equal(result.state, 'done');
  }
  assert.deepEqual(calls, []); assert.deepEqual(listQueuedPrompts(db, 'old'), []);
  await assert.rejects(callTeamTool('team_wait', { session: 'old' }, 'live', req, () => assert.fail('must authorize before waiting')), /team.forbidden/);
  errors.length = 0;
  await assert.rejects(callTeamTool('team_wait', { session: 'missing' }, 'parent', req, () => assert.fail('must validate membership')), /team.not_member/);
});

for (const retiring of [false, true]) for (const parentless of [false, true]) test(`messages through a ${retiring ? 'transitioning' : 'retired'} parent reach the user (parentless=${parentless})`, async t => {
  const { db, ctx, calls, replies, errors, client } = fixture(t, false);
  if (retiring) t.after(reserveHandoff(db, 'parent'));
  else db.prepare('UPDATE sessions SET handed_off = 1 WHERE id = ?').run('parent');
  db.prepare('UPDATE sessions SET parentless = ? WHERE id = ?').run(Number(parentless), 'live');
  ctx.record = (session, kind, payload) => append(db, session, { kind, payload });
  ctx.teamLifecycle = new TeamLifecycle(() => ctx, () => false);
  t.after(() => ctx.teamLifecycle.close());
  addTeamMessage(db, { id: 'original', team: 'team', from_session: 'parent', to_session: 'live', reply_to: null, body: 'Report back', urgent: 0, created_at: 0 });
  for (const urgent of [false, true]) for (const reply of [false, true]) {
    await teamMethod(ctx, client, 'message', 'team.message', { actor: 'live', ...(reply ? { replyTo: 'original' } : { to: 'parent' }), text: 'Please review', urgent });
    assert.deepEqual(errors, []);
    const message = replies.at(-1).id;
    const question = JSON.parse(replay(db, 'live').filter(e => e.kind === 'question_request').at(-1).payload);
    assert.equal(question.teamMessage, message);
    assert.equal(getTeamUserMessage(db, 'live', question.request).message, message);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(unreadTeamMessages(db, 'parent'), []);
  assert.deepEqual(listQueuedPrompts(db, 'parent'), []);
  await teamMethod(ctx, client, 'missing', 'team.message', { actor: 'live', to: 'missing', text: 'not a member' });
  assert.equal(errors.at(-1).code, 'team.not_member');
});
