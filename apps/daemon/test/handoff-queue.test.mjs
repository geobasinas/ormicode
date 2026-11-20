import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { openStore, createSession, createTeam, setSessionTeam, setState, getSession, addQueuedPrompt, listQueuedPrompts } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { EMPTY } from '@ormicode/pricing';
import { handoffRequest, resolveHandoffApproval } from '../src/handoff-dispatch.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';
import { TeamApprovals } from '../src/team-approvals.ts';
import { stateFor } from '../src/supervisor-state.ts';
import { resumeSession } from '../src/team-resume.ts';

for (const paused of [false, true]) for (const failure of ['none', 'ready', 'prompt']) test(`approved handoff reserves the outgoing queue (paused=${paused}) and ${failure === 'none' ? 'transfers it after starting the replacement' : `restores it after ${failure} failure`}`, async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  for (const id of ['parent', 'outgoing', 'sibling']) createSession(db, { id, parent: id === 'parent' ? undefined : 'parent', machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' });
  for (const id of ['outgoing', 'sibling']) setSessionTeam(db, id, 'team');
  setState(db, 'parent', 'running');
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const sent = [], replies = [];
  const held = { text: 'held follow-up', actor: 'auto', images: [{ data: 'aGk=', mimeType: 'image/png' }] };
  const ctx = { db, paused: new Set(paused ? ['outgoing'] : []), heldPrompts: new Map(paused ? [['outgoing', [held]]] : []), teamLifecycle: { available() {} }, handoffsInTurn: new Map(), prices: { table: () => EMPTY }, spawnWorker() {},
    async ensureWorker() { entered(); await gate; if (failure === 'ready') throw new Error('not ready'); },
    stopWorker: async () => {}, services: { stopSession: async () => {} },
    record(session, kind, payload) {
      [kind, payload] = ctx.teamApprovals.event(session, kind, payload);
      append(db, session, { kind, payload });
      const state = kind === 'state' ? payload.state : kind === 'approval_decision' && payload.approvalKind === 'handoff' ? undefined : stateFor[kind];
      if (state) setState(db, session, state);
    },
  };
  ctx.teamApprovals = new TeamApprovals(() => ctx, () => true);
  const delivery = createPromptDelivery({ db, ensureWorker: async () => {}, paused: ctx.paused, heldPrompts: ctx.heldPrompts, lastPrompt: new Map(), record: ctx.record,
    toWorker: async (session, method, body) => {
      assert.equal(method, 'worker.prompt');
      if (failure === 'prompt' && session !== 'outgoing') return { type: 'err' };
      sent.push({ session, text: body.text }); ctx.record(session, 'turn_start', {}); return { type: 'res' };
    },
  });
  Object.assign(ctx, delivery);
  const client = { link: { reply: (_id, body) => replies.push(body), replyError: (_id, code) => replies.push({ code }) } };
  const pending = handoffRequest(ctx, client, 'handoff', { session: 'outgoing', to: {}, mode: 'rehydrate', agentApproval: true });
  const request = JSON.parse(replay(db, 'outgoing').find(e => e.kind.endsWith('approval_request')).payload).request;
  addQueuedPrompt(db, 'outgoing', { id: 'first', text: 'queued follow-up', createdAt: 1 });
  assert.equal(resolveHandoffApproval(ctx, 'outgoing', request, 'approve'), true);
  await ready;
  await delivery.drainQueue('sibling', true, true); await setImmediate();
  assert.equal(await delivery.sendPrompt('outgoing', 'must not bypass the reservation'), false);
  assert.deepEqual(sent, []);
  addQueuedPrompt(db, 'outgoing', { id: 'late', text: 'late follow-up', createdAt: 2 });
  release(); await pending;
  if (failure !== 'none') {
    assert.equal(replies.at(-1).code, 'handoff.failed');
    if (paused) {
      assert.deepEqual(sent, []); assert.equal(ctx.paused.has('outgoing'), true);
      assert.deepEqual(ctx.heldPrompts.get('outgoing'), [held]);
      assert.deepEqual(listQueuedPrompts(db, 'outgoing').map(p => p.id), ['first', 'late']);
      return;
    }
    assert.deepEqual(sent, [{ session: 'outgoing', text: 'queued follow-up' }]);
    assert.deepEqual(listQueuedPrompts(db, 'outgoing').map(p => p.id), ['late']);
    return;
  }
  const child = replies.at(-1).session;
  assert.equal(getSession(db, 'outgoing').handed_off, 1);
  assert.equal(listQueuedPrompts(db, 'outgoing').length, 0);
  assert.deepEqual(listQueuedPrompts(db, child).map(p => p.id), ['first', 'late']);
  assert.equal(sent.length, 1); assert.equal(sent[0].session, child); assert.match(sent[0].text, /Handoff brief:/);
  assert.equal(ctx.paused.has('outgoing'), false); assert.equal(ctx.heldPrompts.has('outgoing'), false);
  if (paused) {
    assert.equal(ctx.paused.has(child), true); assert.deepEqual(ctx.heldPrompts.get(child), [held]);
    ctx.record(child, 'turn_end', {}); await delivery.drainQueue(child);
    assert.equal(sent.length, 1);
    assert.equal(await resumeSession(ctx, child), true);
    assert.deepEqual(sent.at(-1), { session: child, text: held.text });
    assert.equal(ctx.heldPrompts.has(child), false);
  }
  for (const text of ['queued follow-up', 'late follow-up']) {
    ctx.record(child, 'turn_end', {}); await delivery.drainQueue(child);
    assert.deepEqual(sent.at(-1), { session: child, text });
  }
  assert.equal(listQueuedPrompts(db, child).length, 0);
});
