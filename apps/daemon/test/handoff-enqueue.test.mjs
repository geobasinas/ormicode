import test from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '@ormicode/protocol';
import { openStore, createSession, listQueuedPrompts, createTeam, setSessionTeam, addTeamMessage, addTeamUserMessage } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { onClientFrame } from '../src/dispatch.ts';
import { lateQuestionAnswer } from '../src/late-question.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';
import { TeamLifecycle } from '../src/team-lifecycle.ts';
import { reserveHandoff } from '../src/handoff-transition.ts';
import { recoverSessions } from '../src/recovery.ts';

for (const retiring of [false, true]) test(`all external prompt and reply paths reject a ${retiring ? 'retiring' : 'handed-off'} session`, async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const session = newId('s'), parent = newId('s'), request = newId('req');
  for (const id of [session, parent]) createSession(db, { id, machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  createTeam(db, { id: 'team', parent, project: '/repo' }); setSessionTeam(db, session, 'team');
  if (retiring) t.after(reserveHandoff(db, session));
  else db.prepare('UPDATE sessions SET handed_off = 1 WHERE id = ?').run(session);
  append(db, session, { kind: 'question_request', payload: { request, daemonInteraction: true, questions: [{ question: 'Which?', options: [] }] } });
  const ctx = { db, paused: new Set([session]), heldPrompts: new Map(), lastPrompt: new Map(),
    ensureWorker: () => assert.fail('must not start a retired worker'), record: (s, kind, payload) => append(db, s, { kind, payload }) };
  Object.assign(ctx, createPromptDelivery({ ...ctx, toWorker: () => assert.fail('must not send a retired prompt') }));
  const replies = [], errors = [];
  const client = { device: 'user', link: { reply: (_id, body) => replies.push(body), replyError: (_id, code, message) => errors.push({ code, message }) } };
  for (const method of ['session.prompt', 'session.retry', 'session.pause', 'session.resume', 'session.queue.add', 'session.queue.update', 'session.queue.remove', 'session.queue.move']) {
    await onClientFrame(ctx, client, { type: 'req', id: 'test', method, body: { session, text: 'lost', id: newId('q'), index: 0 } });
    assert.equal(errors.at(-1).code, 'session.busy', method); assert.match(errors.at(-1).message, /handed off/);
  }
  assert.equal(lateQuestionAnswer(ctx, client, 'reply', session, request, { 'Which?': 'A' }), true);
  assert.equal(errors.at(-1).code, 'session.busy');
  const message = newId('q'), teamRequest = newId('req');
  addTeamMessage(db, { id: message, team: 'team', from_session: session, to_session: parent, reply_to: null, urgent: 0, body: 'Question', created_at: 0 });
  addTeamUserMessage(db, teamRequest, message);
  const lifecycle = new TeamLifecycle(() => ctx, () => false); t.after(() => lifecycle.close());
  assert.equal(await lifecycle.answer(client, 'reply', { session, request: teamRequest, answers: { Question: 'A' } }), true);
  assert.equal(errors.at(-1).code, 'session.busy');
  ctx.enqueueAutoPrompt(session, 'automatic follow-up', []);
  assert.equal(await ctx.drainQueue(session), false); assert.equal(await ctx.sendPrompt(session, 'direct'), false);
  assert.deepEqual(replies, []); assert.equal(ctx.heldPrompts.size, 0); assert.deepEqual(listQueuedPrompts(db, session), []);
  assert.equal(replay(db, session).some(e => e.kind === 'question_answer'), false);
  if (!retiring) assert.equal(recoverSessions(db, 'all').autoResume.some(c => c.s.id === session), false);
});
