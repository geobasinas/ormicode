import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, getSession, createTeam, setSessionTeam, setState, pendingQuestions, addTeamMessage, addTeamUserMessage, hasTeamUserMessages, listQueuedPrompts } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { summarize } from '@ormicode/digest';
import { EMPTY } from '@ormicode/pricing';
import { handoffRequest } from '../src/handoff-dispatch.ts';
import { UserInteractions } from '../src/user-interactions.ts';
import { TeamLifecycle } from '../src/team-lifecycle.ts';
import { hasUnansweredUserQuestion } from '../src/late-question.ts';
import { stateFor } from '../src/supervisor-state.ts';
import { recoverSessions } from '../src/recovery.ts';

function fixture(t) {
  const db = openStore(':memory:'); t.after(() => db.close());
  for (const id of ['old', 'parent']) createSession(db, { id, machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  const replies = [], errors = [];
  const ctx = { db, paused: new Set(), heldPrompts: new Map(), handoffsInTurn: new Map(), prices: { table: () => EMPTY },
    spawnWorker() {}, ensureWorker: async () => {}, services: { stopSession: async () => {} },
    sendPrompt: async () => true, drainQueue: async () => true, teamApprovals: { waiting: () => false },
    record(session, kind, payload) { append(db, session, { kind, payload }); const state = kind === 'state' ? payload.state : stateFor[kind]; if (state) setState(db, session, state); },
  };
  ctx.interactions = new UserInteractions(() => ctx);
  ctx.teamLifecycle = new TeamLifecycle(() => ctx, () => false);
  ctx.stopWorker = async session => ctx.interactions.unavailable(session);
  t.after(() => { ctx.interactions.close(); ctx.teamLifecycle.close(); });
  const client = { device: 'user', link: { reply: (_id, body) => replies.push(body), replyError: (_id, code) => errors.push(code) } };
  return { db, ctx, client, replies, errors };
}

for (const failure of [false, true]) test(`handoff ${failure ? 'failure retains late-answerable' : 'success permanently expires'} live daemon, native and parentless questions`, async t => {
  const { db, ctx, client, replies, errors } = fixture(t);
  const asking = ctx.interactions.ask(client, 'ask', 'old', { question: 'Choose?', options: ['A'] });
  ctx.record('old', 'question_request', { request: 'native', questions: [] });
  ctx.record('old', 'question_request', { request: 'answered', questions: [] });
  ctx.record('old', 'question_answer', { request: 'answered', answers: {} });
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' }); setSessionTeam(db, 'old', 'team');
  addTeamMessage(db, { id: 'message', team: 'team', from_session: 'old', to_session: 'parent', reply_to: null, body: 'Help?', urgent: 0, created_at: 0 });
  addTeamUserMessage(db, 'team-question', 'message');
  ctx.record('old', 'question_request', { request: 'team-question', teamMessage: 'message', questions: [] });
  ctx.sendPrompt = async () => !failure;
  await handoffRequest(ctx, client, 'handoff', { session: 'old', to: {}, mode: 'rehydrate', confirmed: true });
  await asking;
  assert.equal(getSession(db, 'old').handed_off, Number(!failure));
  assert.equal(hasUnansweredUserQuestion(db, 'old'), failure);
  assert.equal(hasTeamUserMessages(db, 'old'), failure);
  const events = replay(db, 'old').map(e => ({ ...e, payload: JSON.parse(e.payload) }));
  const retired = events.filter(e => e.kind === 'interaction_expired' && e.payload.reason === 'handed_off');
  if (failure) {
    assert.ok(errors.includes('handoff.failed')); assert.equal(retired.length, 0);
    assert.equal(ctx.teamLifecycle.state(getSession(db, 'old')), 'awaiting_input');
  } else {
    assert.ok(replies.at(-1).session); assert.deepEqual(pendingQuestions(db, 'old'), []);
    assert.equal(retired.length, 3); assert.ok(retired.every(e => e.payload.answerable === false));
    const row = getSession(db, 'old');
    assert.equal(ctx.teamLifecycle.state(row), 'done');
    assert.equal(summarize({ id: 'old', state: row.state, updatedAt: row.updated_at }, events, 0).wants, null);
    await ctx.interactions.method(client, 'late', 'session.answer', { session: 'old', request: 'team-question', answers: { Help: 'yes' } });
    assert.equal(errors.at(-1), 'session.busy'); assert.deepEqual(listQueuedPrompts(db, 'old'), []);
  }
});

test('startup closes old retired questions once, without touching live sessions or already-closed questions', t => {
  const { db, ctx } = fixture(t);
  assert.deepEqual(pendingQuestions(db, 'old'), []);
  db.prepare('UPDATE sessions SET handed_off = 1 WHERE id = ?').run('old'); setState(db, 'old', 'done');
  for (const session of ['old', 'parent']) ctx.record(session, 'question_request', { request: 'late', daemonInteraction: true });
  ctx.record('old', 'interaction_expired', { request: 'late', answerable: true });
  setState(db, 'old', 'done');
  recoverSessions(db, 'wait'); recoverSessions(db, 'wait');
  assert.deepEqual(pendingQuestions(db, 'old'), []); assert.deepEqual(pendingQuestions(db, 'parent'), ['late']);
  assert.equal(replay(db, 'old').filter(e => e.kind === 'interaction_expired').length, 2);
  assert.equal(ctx.teamLifecycle.state(getSession(db, 'old')), 'done');
});
