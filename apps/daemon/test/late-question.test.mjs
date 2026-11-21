import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, listQueuedPrompts, setState } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';
import { append, replay } from '@ormicode/journal';
import { UserInteractions } from '../src/user-interactions.ts';
import { hasUnansweredUserQuestion } from '../src/late-question.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';
import { recoverSessions } from '../src/recovery.ts';
import { TeamLifecycle } from '../src/team-lifecycle.ts';

test('late choices survive daemon restart, reject invalid/empty/repeated answers, and deliver only at the next step', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-late-question-')), path = join(dir, 'store.db'), session = newId('s'), request = newId('req');
  let db = openStore(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); });
  createSession(db, { id: session, machine: 'm', project: 'p', vendor: 'fake', transport: 'cli', cwd: dir });
  append(db, session, { kind: 'question_request', payload: { request, daemonInteraction: true, questions: [{ question: 'Choose?', options: [{ label: 'A' }, { label: 'B' }] }] } });
  setState(db, session, 'awaiting_input'); db.close(); db = openStore(path);
  recoverSessions(db, 'wait');
  assert.equal(JSON.parse(replay(db, session).findLast(e => e.kind === 'interaction_expired').payload).answerable, true);
  const replies = [], prompts = [], ctx = { db, record(s, kind, payload) { append(db, s, { kind, payload }); } };
  const delivery = () => createPromptDelivery({ db, notesDir: dir, paused: new Set(), heldPrompts: new Map(), lastPrompt: new Map(), ensureWorker: async () => {},
    toWorker: async (s, method, body) => { prompts.push(body.text); setState(db, s, 'running'); return { type: 'res' }; }, terminals: {}, previewEntries: () => [], record: ctx.record });
  Object.assign(ctx, delivery());
  const lifecycle = new TeamLifecycle(() => ctx, () => false), interactions = new UserInteractions(() => ctx);
  t.after(() => { interactions.close(); lifecycle.close(); });
  const client = { device: 'user-device', link: { reply: (id, body) => replies.push({ body }), replyError: (id, code) => replies.push({ code }) } };
  assert.equal(hasUnansweredUserQuestion(db, session), true);
  assert.equal(lifecycle.state({ id: session, archived: 0, state: 'interrupted' }), 'awaiting_input');
  for (const answers of [{}, { 'Choose?': ' ' }, { 'Choose?': 'C' }, { 'Wrong?': 'A' }]) {
    await interactions.method(client, 'invalid', 'session.answer', { session, request, answers });
    assert.equal(replies.at(-1).code, 'team.invalid'); assert.equal(listQueuedPrompts(db, session).length, 0);
  }
  setState(db, session, 'running');
  await interactions.method(client, 'answer', 'session.answer', { session, request, answers: { 'Choose?': 'B' } });
  assert.equal(replies.at(-1).body.answered, true); assert.equal(prompts.length, 0);
  assert.equal(listQueuedPrompts(db, session).length, 1); assert.equal(hasUnansweredUserQuestion(db, session), false);
  db.close(); db = openStore(path); ctx.db = db; Object.assign(ctx, delivery());
  assert.match(listQueuedPrompts(db, session)[0].text, /Choose\?\nB/);
  await interactions.method(client, 'repeat', 'session.answer', { session, request, answers: { 'Choose?': 'A' } });
  assert.equal(replies.at(-1).code, 'session.already_decided'); assert.equal(listQueuedPrompts(db, session).length, 1);
  setState(db, session, 'idle'); await ctx.drainQueue(session);
  assert.match(prompts[0], /Choose\?\nB/); assert.equal(listQueuedPrompts(db, session).length, 0);
  const approval = newId('req');
  append(db, session, { kind: 'approval_request', payload: { request: approval, daemonInteraction: true, userOnly: true } });
  setState(db, session, 'awaiting_approval'); recoverSessions(db, 'wait');
  await interactions.method(client, 'approve', 'session.decide', { session, request: approval, option: 'approve' });
  assert.equal(replies.at(-1).code, 'session.already_decided');
  await interactions.method(client, 'not-a-question', 'session.answer', { session, request: approval, answers: { 'Choose?': 'A' } });
  assert.equal(replies.at(-1).code, 'session.already_decided'); assert.equal(listQueuedPrompts(db, session).length, 0);
});
