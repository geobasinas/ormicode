import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, createTeam, setSessionTeam, setState, getSession, listQueuedPrompts, unreadTeamMessages } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';
import { EMPTY } from '@ormicode/pricing';
import { append, replay } from '@ormicode/journal';
import { handoffRequest, resolveHandoffApproval, expireHandoffApprovals } from '../src/handoff-dispatch.ts';
import { TeamApprovals } from '../src/team-approvals.ts';
import { stateFor } from '../src/supervisor-state.ts';
import { teamMethod } from '../src/team-methods.ts';
import { interrupt } from '../src/team-interrupt.ts';

function fixture(t, route, state = 'idle') {
  const db = openStore(':memory:'), session = newId('s'), parent = newId('s');
  for (const id of [parent, session]) {
    createSession(db, { id, parent: id === session ? parent : undefined, machine: 'm', project: 'p', cwd: '.', vendor: 'fake', transport: 'cli' });
    setState(db, id, id === parent ? 'running' : state);
  }
  if (route !== 'user') {
    const team = newId('t'); createTeam(db, { id: team, parent, project: 'p' }); setSessionTeam(db, session, team);
  }
  const replies = [], drains = [], ctx = { db, paused: new Set(), heldPrompts: new Map(), handoffsInTurn: new Map(), prices: { table: () => EMPTY },
    drainQueue: async s => { drains.push({ session: s, state: getSession(db, s).state }); return true; },
    spawnWorker: () => assert.fail('expired handoff must not spawn'),
    record(s, kind, payload) {
      [kind, payload] = ctx.teamApprovals.event(s, kind, payload);
      append(db, s, { kind, payload });
      const state = kind === 'state' ? payload.state : kind === 'approval_decision' && payload.approvalKind === 'handoff' ? undefined : stateFor[kind];
      if (state) setState(db, s, state);
    },
  };
  ctx.teamApprovals = new TeamApprovals(() => ctx, () => true);
  ctx.record(session, state === 'running' ? 'turn_start' : 'turn_end', {});
  const client = { link: { reply: (id, body) => replies.push(body), replyError: (id, code) => replies.push({ code }) } };
  t.after(() => { expireHandoffApprovals(ctx); db.close(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { db, session, parent, ctx, client, replies, drains };
}

for (const route of ['user', 'parent', 'escalated']) test(`${route}-routed handoffs expire at ten minutes and reject late approval`, async t => {
  const { db, session, parent, ctx, client, replies } = fixture(t, route);
  const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', brief: 'brief', agentApproval: true });
  const request = JSON.parse(replay(db, session).find(e => e.kind.endsWith('approval_request')).payload).request;
  if (route === 'escalated') ctx.teamApprovals.escalate(client, 'escalate', { actor: parent, session, request });
  t.mock.timers.tick(599_999);
  assert.equal(replay(db, session).filter(e => e.kind === 'interaction_expired').length, 0);
  t.mock.timers.tick(1); await pending;
  assert.equal(replies.at(-1).code, 'handoff.declined');
  const expired = replay(db, session).filter(e => e.kind === 'interaction_expired');
  assert.equal(expired.length, 1);
  assert.deepEqual(JSON.parse(expired[0].payload), { request, approvalKind: 'handoff', reason: 'timeout' });
  assert.equal(getSession(db, session).state, 'idle');
  assert.equal(ctx.teamApprovals.waiting(session), false);
  assert.equal(resolveHandoffApproval(ctx, session, request, 'approve'), false);
  t.mock.timers.tick(600_000);
  assert.equal(replay(db, session).filter(e => e.kind === 'interaction_expired').length, 1);
});

for (const route of ['user', 'parent', 'escalated']) for (const active of [false, true]) for (const other of ['none', 'user', 'delegated']) {
  if (route === 'user' && other === 'delegated') continue;
  test(`${route} denial derives ${active ? 'active' : 'idle'} activity with ${other} other approvals`, async t => {
    const { db, session, parent, ctx, client, drains } = fixture(t, route, 'running');
    const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', agentApproval: true });
    const request = JSON.parse(replay(db, session).find(e => e.kind.endsWith('approval_request')).payload).request;
    if (!active) ctx.record(session, 'turn_end', {});
    if (route === 'escalated') ctx.teamApprovals.escalate(client, 'escalate', { actor: parent, session, request });
    if (other !== 'none') ctx.record(session, 'approval_request', { request: newId('req'), userOnly: other === 'user', options: [{ id: 'allow', label: 'Allow once' }] });
    if (route === 'parent') await ctx.teamApprovals.approve(client, 'deny', { actor: parent, session, request, option: 'deny', reason: 'routine' });
    else await ctx.teamApprovals.userDecision(client, 'deny', { session, request, option: 'deny' });
    await pending;
    const expected = other !== 'none' ? 'awaiting_approval' : active ? 'running' : 'idle';
    assert.equal(getSession(db, session).state, expected);
    assert.deepEqual(drains, [{ session, state: expected }]);
    assert.equal(resolveHandoffApproval(ctx, session, request, 'approve'), false);
  });
}

test('approved handoff failure restores current activity instead of the request-time snapshot', async t => {
  const { db, session, ctx, client, replies, drains } = fixture(t, 'user', 'running');
  ctx.spawnWorker = () => {};
  ctx.ensureWorker = async () => { ctx.record(session, 'turn_end', {}); throw new Error('replacement failed'); };
  ctx.stopWorker = async () => {};
  ctx.services = { stopSession: async () => {} };
  const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', agentApproval: true });
  const request = JSON.parse(replay(db, session).find(e => e.kind === 'approval_request').payload).request;
  assert.equal(resolveHandoffApproval(ctx, session, request, 'approve'), true);
  await pending;
  assert.equal(replies.at(-1).code, 'handoff.failed');
  assert.equal(getSession(db, session).state, 'idle');
  assert.deepEqual(drains, [{ session, state: 'idle' }]);
});

for (const route of ['user', 'parent', 'escalated']) for (const remaining of ['user', 'delegated', 'decided', 'expired', 'none']) {
  if (remaining === 'delegated' && route === 'user') continue;
  test(`${route} handoff timeout preserves outstanding ${remaining} approval state`, async t => {
    const { db, session, parent, ctx, client } = fixture(t, route, 'running');
    const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', brief: 'brief', agentApproval: true });
    const request = JSON.parse(replay(db, session).find(e => e.kind.endsWith('approval_request')).payload).request;
    if (route === 'escalated') ctx.teamApprovals.escalate(client, 'escalate', { actor: parent, session, request });
    const other = newId('req');
    if (remaining !== 'none') {
      ctx.record(session, 'approval_request', { request: other, userOnly: remaining !== 'delegated', options: [{ id: 'allow', label: 'Allow once' }] });
      if (remaining === 'decided') ctx.record(session, 'approval_decision', { request: other, option: 'allow' });
      if (remaining === 'expired') ctx.record(session, 'interaction_expired', { request: other });
    }
    const beforeExpiry = getSession(db, session).state;
    if (remaining === 'user') assert.equal(beforeExpiry, 'awaiting_approval');
    t.mock.timers.tick(600_000); await pending;
    const waiting = remaining === 'user' || remaining === 'delegated';
    assert.equal(getSession(db, session).state, waiting ? 'awaiting_approval' : 'running');
    assert.equal(ctx.teamApprovals.waiting(session), remaining === 'delegated');
    assert.equal(replay(db, session).filter(e => e.kind === 'interaction_expired' && JSON.parse(e.payload).request === request).length, 1);
    assert.equal(resolveHandoffApproval(ctx, session, request, 'approve'), false);
  });
}

for (const anotherApproval of [false, true]) test(`handoff escalated after turn_end expires to ${anotherApproval ? 'awaiting_approval' : 'idle'}`, async t => {
  const { db, session, parent, ctx, client } = fixture(t, 'parent', 'running');
  const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', brief: 'brief', agentApproval: true });
  const request = JSON.parse(replay(db, session).find(e => e.kind === 'team_approval_request').payload).request;
  ctx.record(session, 'turn_end', {});
  assert.equal(getSession(db, session).state, 'idle');
  ctx.teamApprovals.escalate(client, 'escalate', { actor: parent, session, request });
  assert.equal(getSession(db, session).state, 'awaiting_approval');
  if (anotherApproval) ctx.record(session, 'approval_request', { request: newId('req'), userOnly: true });
  t.mock.timers.tick(600_000); await pending;
  assert.equal(getSession(db, session).state, anotherApproval ? 'awaiting_approval' : 'idle');
});

for (const route of ['parent', 'escalated']) for (const other of ['none', 'user', 'delegated']) test(`urgent wake ignores ${route} handoff but respects ${other} other approvals`, async t => {
  const { db, session, parent, ctx, client, drains } = fixture(t, route, 'running');
  ctx.teamLifecycle = { preserveHandoffs: async (_session, action) => action() };
  ctx.toWorker = async () => assert.fail('an idle worker must not be aborted');
  const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', agentApproval: true });
  const request = JSON.parse(replay(db, session).find(e => e.kind === 'team_approval_request').payload).request;
  ctx.record(session, 'turn_end', {});
  if (route === 'escalated') ctx.teamApprovals.escalate(client, 'escalate', { actor: parent, session, request });
  if (other !== 'none') ctx.record(session, 'approval_request', { request: newId('req'), userOnly: other === 'user', options: [{ id: 'allow', label: 'Allow once' }] });
  await teamMethod(ctx, client, 'message', 'team.message', { actor: parent, to: session, text: 'wake up', urgent: true });
  assert.equal(getSession(db, session).state, other === 'none' ? 'idle' : 'awaiting_approval');
  assert.equal(drains.length, other === 'none' ? 1 : 0);
  assert.equal(listQueuedPrompts(db, session).length, other === 'none' ? 1 : 0);
  assert.equal(unreadTeamMessages(db, session).at(-1).body, 'wake up');
  assert.equal(replay(db, session).some(e => e.kind === 'interaction_expired' && JSON.parse(e.payload).request === request), false);
  assert.equal(resolveHandoffApproval(ctx, session, request, 'deny'), true);
  await pending;
});

test('failed urgent interruption leaves its escalated handoff pending without waking the busy child', async t => {
  const { db, session, parent, ctx, client, drains } = fixture(t, 'escalated', 'running');
  ctx.teamLifecycle = { preserveHandoffs: async (_session, action) => action() };
  ctx.toWorker = async () => ({ type: 'err', code: 'agent.unsupported' });
  const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', agentApproval: true });
  const request = JSON.parse(replay(db, session).find(e => e.kind === 'team_approval_request').payload).request;
  ctx.teamApprovals.escalate(client, 'escalate', { actor: parent, session, request });
  await assert.rejects(interrupt(ctx, session, { timeoutMs: 0 }), /could not be interrupted/);
  assert.equal(getSession(db, session).state, 'awaiting_approval');
  assert.equal(drains.length, 0);
  assert.equal(resolveHandoffApproval(ctx, session, request, 'deny'), true);
  await pending;
});

for (const route of ['delegated', 'escalated_before_end', 'escalated_after_end']) for (const method of ['team.cancel', 'team.reassign']) {
  test(`${method} expires an ended turn's ${route} handoff without aborting an idle worker`, async t => {
    const { db, session, parent, ctx, client, replies } = fixture(t, 'parent', 'running');
    ctx.toWorker = async () => assert.fail('there is no active turn to abort');
    ctx.drainQueue = async () => { assert.equal(getSession(db, session).state, 'idle'); return false; };
    const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', brief: 'brief', agentApproval: true });
    const request = JSON.parse(replay(db, session).find(e => e.kind === 'team_approval_request').payload).request;
    const escalate = () => ctx.teamApprovals.escalate(client, 'escalate', { actor: parent, session, request });
    if (route === 'escalated_before_end') escalate();
    ctx.record(session, 'turn_end', {});
    if (route === 'escalated_after_end') escalate();
    await teamMethod(ctx, client, 'cancel', method, { actor: parent, session, task: 'replacement task' });
    await pending;
    assert.ok(replies.some(r => method === 'team.cancel' ? r.interrupted : r.accepted));
    assert.ok(replies.some(r => r.code === 'handoff.declined'));
    assert.equal(getSession(db, session).state, 'idle');
    assert.equal(ctx.teamApprovals.waiting(session), false);
    assert.deepEqual(replay(db, session).filter(e => e.kind === 'interaction_expired').map(e => JSON.parse(e.payload)), [{ request, approvalKind: 'handoff', reason: 'cancelled' }]);
    assert.equal(resolveHandoffApproval(ctx, session, request, 'approve'), false);
    assert.equal(listQueuedPrompts(db, session).length, method === 'team.reassign' ? 1 : 0);
  });
}
