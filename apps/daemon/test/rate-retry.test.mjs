import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { openStore, createSession, createTeam, setSessionTeam, getSession, setState } from '@ormicode/session-store';
import { rateRetries } from '../src/rate-retry.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';

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
