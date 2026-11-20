import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '@ormicode/protocol';
import { openStore, createSession, createTeam, setSessionTeam, setState, getSession, unreadTeamMessages, listQueuedPrompts } from '@ormicode/session-store';
import { TeamLifecycle, silenceInterval } from '../src/team-lifecycle.ts';

function fixture(t) {
  const db = openStore(':memory:'); t.after(() => { if (db.open) db.close(); });
  const parent = newId('s'), child = newId('s'), team = newId('t');
  for (const id of [parent, child]) createSession(db, { id, machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo', ...(id === child ? { parent } : {}) });
  createTeam(db, { id: team, parent, project: '/repo' });
  for (const id of [parent, child]) setSessionTeam(db, id, team);
  const events = [], live = new Set([parent, child]);
  const ctx = { db, teamApprovals: { unavailable() {} }, drainQueue: async () => true,
    record(session, kind, payload) { events.push({ session, kind, ...payload }); lifecycle.event(session, kind, payload, 0); } };
  const lifecycle = new TeamLifecycle(() => ctx, session => live.has(session));
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.silenceMs', '10');
  const nudges = () => events.filter(e => e.session === parent && e.kind === 'team_message' && e.nudge);
  return { db, parent, child, team, events, live, lifecycle, nudges, ctx };
}

test('silence interval is ten minutes by default and rejects invalid settings', () => {
  for (const value of [undefined, null, 0, -1, 1.1, '10', Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(silenceInterval(value), 600_000);
  assert.equal(silenceInterval(25), 25);
});

test('running children nudge once per silent stretch; streamed events reset it without killing', t => {
  const { db, parent, child, lifecycle, nudges, live } = fixture(t);
  setState(db, child, 'running');
  lifecycle.event(child, 'turn_start', {}, 0);
  lifecycle.check(9); assert.equal(nudges().length, 0);
  lifecycle.check(10); assert.equal(nudges().length, 1);
  lifecycle.check(100); assert.equal(nudges().length, 1);
  assert.equal(unreadTeamMessages(db, parent).length, 1);
  assert.equal(listQueuedPrompts(db, parent).length, 1);
  lifecycle.event(child, 'text_delta', { text: 'still working' }, 100);
  lifecycle.check(109); assert.equal(nudges().length, 1);
  lifecycle.check(110); assert.equal(nudges().length, 2);
  assert.equal(getSession(db, child).state, 'running'); assert.ok(live.has(child));
});

test('nonrunning, disconnected and closed-team children do not nudge; busy parents use inbox only', t => {
  const { db, parent, child, team, lifecycle, nudges, live } = fixture(t);
  lifecycle.event(child, 'text_delta', {}, 0);
  for (const state of ['idle', 'starting', 'retrying', 'awaiting_approval', 'awaiting_input', 'done', 'failed', 'archived']) {
    setState(db, child, state); lifecycle.check(100); assert.equal(nudges().length, 0);
  }
  setState(db, child, 'running'); live.delete(child); lifecycle.check(100); assert.equal(nudges().length, 0);
  live.add(child); db.prepare('UPDATE teams SET closed_at = 1 WHERE id = ?').run(team);
  lifecycle.check(100); assert.equal(nudges().length, 0);
  db.prepare('UPDATE teams SET closed_at = NULL WHERE id = ?').run(team);
  setState(db, parent, 'running'); lifecycle.check(100);
  assert.equal(nudges().length, 1); assert.equal(listQueuedPrompts(db, parent).length, 0);
});

test('failed parents detach their children, parentless nudges reach the user, reattachment clears flags', t => {
  const { db, parent, child, events, lifecycle } = fixture(t);
  setState(db, child, 'running'); lifecycle.event(child, 'turn_start', {}, 0);
  lifecycle.event(parent, 'error', { message: 'failed' }, 0);
  assert.equal(getSession(db, child).parentless, 1);
  lifecycle.check(100); lifecycle.check(200);
  assert.equal(events.filter(e => e.kind === 'question_request').length, 1);
  assert.ok(events.find(e => e.kind === 'team_message' && e.toUser && e.nudge));
  assert.equal(getSession(db, child).state, 'running'); assert.equal(lifecycle.state(getSession(db, child)), 'awaiting_input');
  assert.equal(unreadTeamMessages(db, parent).length, 0);
  lifecycle.available(parent); assert.equal(getSession(db, child).parentless, 0);
  assert.deepEqual(events.filter(e => e.kind === 'team_parent_changed').map(e => e.parentless), [true, false]);
});

test('late worker disconnects and timer callbacks are inert after lifecycle shutdown', t => {
  const { db, parent, child, lifecycle } = fixture(t);
  lifecycle.close(); db.close();
  assert.doesNotThrow(() => lifecycle.unavailable(parent));
  assert.doesNotThrow(() => lifecycle.available(parent));
  assert.doesNotThrow(() => lifecycle.event(child, 'interrupted', {}));
  assert.doesNotThrow(() => lifecycle.check());
});

test('urgent interruption preserves handoffs only for intentional interruption events and releases its scope on failure', async t => {
  const { child, lifecycle, ctx } = fixture(t);
  const preserved = [];
  ctx.teamApprovals.unavailable = (session, preserve) => { assert.equal(session, child); preserved.push(preserve); };
  await lifecycle.preserveHandoffs(child, async () => {
    lifecycle.event(child, 'interrupted', {});
    lifecycle.event(child, 'state', { state: 'interrupted' });
    lifecycle.event(child, 'error', { message: 'actual failure' });
  });
  lifecycle.event(child, 'interrupted', {});
  await assert.rejects(lifecycle.preserveHandoffs(child, async () => { throw new Error('abort failed'); }), /abort failed/);
  lifecycle.event(child, 'interrupted', {});
  assert.deepEqual(preserved, [true, true, false, false, false]);
});
