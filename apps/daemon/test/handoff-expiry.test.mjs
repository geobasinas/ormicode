import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, createTeam, setSessionTeam, setState, getSession } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';
import { EMPTY } from '@ormicode/pricing';
import { append, replay } from '@ormicode/journal';
import { handoffRequest, resolveHandoffApproval, expireHandoffApprovals } from '../src/handoff-dispatch.ts';
import { TeamApprovals } from '../src/team-approvals.ts';
import { stateFor } from '../src/supervisor-state.ts';

for (const route of ['user', 'parent', 'escalated']) test(`${route}-routed handoffs expire at ten minutes and reject late approval`, async t => {
  const db = openStore(':memory:'), session = newId('s'), parent = newId('s');
  for (const id of [parent, session]) {
    createSession(db, { id, parent: id === session ? parent : undefined, machine: 'm', project: 'p', cwd: '.', vendor: 'fake', transport: 'cli' });
    setState(db, id, id === parent ? 'running' : 'idle');
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
  const client = { link: { reply: (id, body) => replies.push(body), replyError: (id, code) => replies.push({ code }) } };
  t.after(() => { expireHandoffApprovals(ctx); db.close(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = handoffRequest(ctx, client, 'handoff', { session, to: {}, mode: 'rehydrate', brief: 'brief', agentApproval: true });
  const request = JSON.parse(replay(db, session)[0].payload).request;
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
