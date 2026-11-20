import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, getSession, listSessions, setState } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { sessionStatus } from '../src/session-status.ts';

test('streaming list refreshes do not reload unchanged transcripts and only read appended events', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  let rowsRead = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const statement = prepare(sql);
    if (/SELECT \* FROM events/.test(sql)) {
      const all = statement.all.bind(statement);
      statement.all = (...args) => { const rows = all(...args); rowsRead += rows.length; return rows; };
    }
    return statement;
  };
  const ctx = { db, teamApprovals: { waiting: () => false }, teamLifecycle: { state: s => s.state } };
  for (let i = 0; i < 8; i++) {
    const id = `session-${i}`;
    createSession(db, { id, machine: 'm', project: 'p', cwd: '/repo', vendor: 'fake', transport: 'cli' });
    append(db, id, { kind: 'turn_start', payload: {} });
    for (let j = 0; j < 100; j++) append(db, id, { kind: 'text', payload: { text: 'x'.repeat(1024) } });
  }
  const refresh = () => listSessions(db).map(s => sessionStatus(ctx, s));
  refresh();
  const coldReads = rowsRead;
  assert.ok(coldReads > 0);
  for (let delta = 0; delta < 10; delta++) refresh();
  assert.equal(rowsRead, coldReads, 'ephemeral deltas must not cause transcript reloads');
  append(db, 'session-0', { kind: 'error', payload: { code: 'unknown', message: 'failed' } });
  append(db, 'session-0', { kind: 'turn_end', payload: {} });
  assert.deepEqual(sessionStatus(ctx, getSession(db, 'session-0')), { state: 'failed', turnCompleted: true });
  assert.equal(rowsRead, coldReads + 2);
  setState(db, 'session-0', 'interrupted');
  assert.equal(sessionStatus(ctx, getSession(db, 'session-0')).state, 'interrupted');
  assert.equal(rowsRead, coldReads + 2, 'row-state changes must remain live without journal reads');
  append(db, 'session-0', { kind: 'state', payload: { state: 'starting', reason: 'prompt_dispatch' } });
  setState(db, 'session-0', 'starting');
  assert.deepEqual(sessionStatus(ctx, getSession(db, 'session-0')), { state: 'starting', turnCompleted: false });
  refresh();
  assert.equal(rowsRead, coldReads + 3);
});

test('status caches are isolated by store and include initially empty sessions', t => {
  for (const failed of [true, false]) {
    const db = openStore(':memory:'); t.after(() => db.close());
    createSession(db, { id: 'same-id', machine: 'm', project: 'p', cwd: '/repo', vendor: 'fake', transport: 'cli' });
    const ctx = { db, teamApprovals: { waiting: () => false }, teamLifecycle: { state: s => s.state } };
    assert.deepEqual(sessionStatus(ctx, getSession(db, 'same-id')), { state: 'idle', turnCompleted: false });
    append(db, 'same-id', { kind: 'turn_start', payload: {} });
    if (failed) append(db, 'same-id', { kind: 'error', payload: {} });
    append(db, 'same-id', { kind: 'turn_end', payload: {} });
    assert.equal(sessionStatus(ctx, getSession(db, 'same-id')).state, failed ? 'failed' : 'idle');
  }
});
