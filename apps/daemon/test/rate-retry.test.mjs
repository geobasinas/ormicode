import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { openStore, createSession, createTeam, setSessionTeam, getSession, setState, unreadTeamMessages } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { rateRetries } from '../src/rate-retry.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';
import { teamMethod } from '../src/team-methods.ts';
import { restoreHandoffState } from '../src/handoff-state.ts';

function fixture(t, retry) {
  const db = openStore(':memory:');
  createSession(db, { id: 'child', machine: 'local', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  setState(db, 'child', 'paused_rate_limited');
  const retries = rateRetries(db, session => retry(session, db));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { retries.close(); db.close(); });
  const fire = async () => { retries.schedule('child', Date.now()); t.mock.timers.tick(1); await setImmediate(); };
  return { db, retries, fire };
}

test('a rate-limited child blocked by team concurrency becomes interrupted instead of rejecting the timer', async t => {
  const { db, fire } = fixture(t, (session, db) => {
    const { sendPrompt } = createPromptDelivery({ db });
    return sendPrompt(session, 'retry held prompt');
  });
  for (const id of ['parent', 'sibling']) createSession(db, { id, parent: id === 'sibling' ? 'parent' : undefined, machine: 'local', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' });
  for (const id of ['child', 'sibling']) setSessionTeam(db, id, 'team');
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.concurrent', '1');
  setState(db, 'sibling', 'running');
  await fire();
  assert.equal(getSession(db, 'child').state, 'interrupted');
  assert.equal(getSession(db, 'child').reason, 'resume_failed');
  assert.equal(getSession(db, 'sibling').state, 'running');
});

test('retry success, missing held prompts and failed retries retain their existing outcomes', async t => {
  for (const [name, retry, expected] of [
    ['success', async () => true, 'paused_rate_limited'],
    ['no held prompt', () => undefined, 'paused_rate_limited'],
    ['worker refused', async () => false, 'interrupted'],
    ['worker rejected', async () => { throw new Error('worker exited'); }, 'interrupted'],
    ['synchronous failure', () => { throw new Error('worker exited'); }, 'interrupted'],
  ]) await t.test(name, async t => {
    const { db, fire } = fixture(t, retry);
    await fire();
    assert.equal(getSession(db, 'child').state, expected);
  });
});

test('cancelled, closed and no-longer-paused retries do not send prompts', async t => {
  let calls = 0;
  const { db, retries } = fixture(t, async () => { calls++; return true; });
  retries.schedule('child', Date.now()); retries.cancel('child');
  t.mock.timers.tick(1); await setImmediate();
  retries.schedule('child', Date.now()); retries.close();
  t.mock.timers.tick(1); await setImmediate();
  retries.schedule('child', Date.now()); setState(db, 'child', 'idle');
  t.mock.timers.tick(1); await setImmediate();
  assert.equal(calls, 0);
});

for (const code of ['rate_limited', 'plan_limit']) test(`urgent messages preserve ${code} pauses and the scheduled retry delivers the held prompt and inbox`, async t => {
  let delivery;
  const { db, retries } = fixture(t, session => delivery.sendPrompt(session, 'held prompt', undefined, { journal: false }));
  createSession(db, { id: 'parent', machine: 'local', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' });
  setSessionTeam(db, 'child', 'team');
  const resetAt = Date.now() + 100;
  append(db, 'child', { kind: 'turn_start', payload: {} });
  append(db, 'child', { kind: 'rate_limited', payload: {} });
  append(db, 'child', { kind: 'error', payload: { code, resetAt } });
  setState(db, 'child', 'paused_rate_limited', code);
  const sent = [], replies = [];
  const ctx = { db, teamApprovals: { waiting: () => false },
    teamLifecycle: { duringUrgentDelivery: async (_session, action) => action() },
    toWorker: async () => assert.fail('a paused worker must not be aborted'),
    drainQueue: async () => assert.fail('a paused child must wait for its retry'),
    record(session, kind, payload) { append(db, session, { kind, payload }); if (kind === 'state') setState(db, session, payload.state); },
  };
  delivery = createPromptDelivery({ db, ensureWorker: async () => {}, lastPrompt: new Map(), record: ctx.record,
    toWorker: async (session, method, body) => {
      assert.equal(method, 'worker.prompt'); sent.push(body.text); setState(db, session, 'running'); return { type: 'res' };
    },
  });
  retries.schedule('child', resetAt);
  const client = { link: { reply: (_id, body) => replies.push(body), replyError: (_id, error) => assert.fail(error) } };
  await teamMethod(ctx, client, 'message', 'team.message', { actor: 'parent', to: 'child', urgent: true, text: 'urgent context' });
  assert.equal(replies.length, 1);
  assert.equal(getSession(db, 'child').state, 'paused_rate_limited');
  assert.equal(getSession(db, 'child').reason, code);
  assert.equal(sent.length, 0);
  t.mock.timers.tick(100); await setImmediate();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /urgent context/); assert.match(sent[0], /held prompt/);
  assert.equal(unreadTeamMessages(db, 'child').length, 0);
  assert.equal(getSession(db, 'child').state, 'running');
});

for (const state of ['paused_rate_limited', 'interrupted', 'failed', 'done']) test(`handoff reconciliation preserves ${state} even with another pending approval`, t => {
  const { db } = fixture(t, () => undefined);
  append(db, 'child', { kind: 'turn_start', payload: {} });
  setState(db, 'child', state, 'resume_failed');
  restoreHandoffState({ db, teamApprovals: { waiting: () => true }, record: () => assert.fail('persistent activity must not be overwritten') }, 'child');
  assert.equal(getSession(db, 'child').state, state);
  assert.equal(getSession(db, 'child').reason, 'resume_failed');
});
