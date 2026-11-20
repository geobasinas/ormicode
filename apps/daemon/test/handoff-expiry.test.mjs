import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, createTeam, setSessionTeam, setState, getSession } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';
import { EMPTY } from '@ormicode/pricing';
import { append, replay } from '@ormicode/journal';
import { handoffRequest, resolveHandoffApproval, expireHandoffApprovals } from '../src/handoff-dispatch.ts';
import { TeamApprovals } from '../src/team-approvals.ts';
import { stateFor } from '../src/supervisor-state.ts';

function fixture(t, route, state = 'idle') {
  const db = openStore(':memory:'), session = newId('s'), parent = newId('s');
  for (const id of [parent, session]) {
    createSession(db, { id, parent: id === session ? parent : undefined, machine: 'm', project: 'p', cwd: '.', vendor: 'fake', transport: 'cli' });
    setState(db, id, id === parent ? 'running' : state);
  }
  if (route !== 'user') {
    const team = newId('t'); createTeam(db, { id: team, parent, project: 'p' }); setSessionTeam(db, session, team);
  }
  const replies = [], ctx = { db, handoffsInTurn: new Map(), prices: { table: () => EMPTY },
    spawnWorker: () => assert.fail('expired handoff must not spawn'),
    record(s, kind, payload) {
      [kind, payload] = ctx.teamApprovals.event(s, kind, payload);
      append(db, s, { kind, payload });
      const state = kind === 'state' ? payload.state : stateFor[kind];
      if (state) setState(db, s, state);
    },
  };
  ctx.teamApprovals = new TeamApprovals(() => ctx, () => true);
  ctx.record(session, state === 'running' ? 'turn_start' : 'turn_end', {});
  const client = { link: { reply: (id, body) => replies.push(body), replyError: (id, code) => replies.push({ code }) } };
  t.after(() => { expireHandoffApprovals(ctx); db.close(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { db, session, parent, ctx, client, replies };
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
    assert.equal(getSession(db, session).state, waiting ? beforeExpiry : 'running');
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
