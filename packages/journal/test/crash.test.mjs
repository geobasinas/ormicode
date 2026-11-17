import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, getSession } from '../../session-store/src/index.ts';
import { append, replay, outboxSince } from '../src/index.ts';

const tmpStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-crash-'));
  const path = join(dir, 'store.db');
  const db = openStore(path);
  createSession(db, { id: 's_test1', machine: 'm_local', project: 'p_app', vendor: 'fake', transport: 'cli', cwd: '/tmp' });
  return { db, path, dir };
};
const reopen = (path) => openStore(path);

// A crash inside the append transaction must leave the store exactly as before:
// no event row, no outbox frame, last_seq untouched — seqs stay gapless.
const phases = ['afterSeqAssign', 'afterEventInsert', 'afterOutboxInsert', 'afterSeqBump'];
for (const phase of phases) {
  test(`crash at ${phase} rolls back the whole append`, () => {
    const { db, path, dir } = tmpStore();
    try {
      append(db, 's_test1', { kind: 'turn_start', payload: { kind: 'turn_start' } });
      assert.throws(
        () => append(db, 's_test1', { kind: 'text', payload: { kind: 'text', text: 'x' } }, { [phase]: () => { throw new Error('simulated crash'); } }),
        /simulated crash/);
      db.close();
      const db2 = reopen(path);
      assert.equal(getSession(db2, 's_test1')?.last_seq, 1, `${phase}: last_seq must not claim a lost event`);
      assert.equal(replay(db2, 's_test1').length, 1, `${phase}: no half-written event row`);
      assert.equal(outboxSince(db2, 's_test1', 0).length, 1, `${phase}: no orphaned outbox frame`);
      const next = append(db2, 's_test1', { kind: 'turn_end', payload: { kind: 'turn_end' } });
      assert.equal(next.seq, 2, `${phase}: next seq continues with no gap`);
      db2.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('crash after commit but before send: outbox still delivers the frame', () => {
  const { db, path, dir } = tmpStore();
  try {
    append(db, 's_test1', { kind: 'turn_start', payload: { kind: 'turn_start' } });
    const committed = append(db, 's_test1', { kind: 'text', payload: { kind: 'text', text: 'hi' } });
    db.close(); // "crash": the frame was never fanned out
    const db2 = reopen(path);
    const pending = outboxSince(db2, 's_test1', 0);
    assert.equal(pending.length, 2);
    assert.equal(pending[1].frame, committed.frame, 'journal is ahead of the wire; resync replays it');
    db2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('interleaved crashes across two sessions keep their journals independent', () => {
  const { db, path, dir } = tmpStore();
  try {
    createSession(db, { id: 's_other', machine: 'm_local', project: 'p_b', vendor: 'fake', transport: 'cli', cwd: '/tmp' });
    append(db, 's_test1', { kind: 'turn_start', payload: { kind: 'turn_start' } });
    append(db, 's_other', { kind: 'turn_start', payload: { kind: 'turn_start' } });
    assert.throws(() => append(db, 's_test1', { kind: 'text', payload: { kind: 'text' } },
      { afterOutboxInsert: () => { throw new Error('boom'); } }));
    db.close();
    const db2 = reopen(path);
    assert.equal(replay(db2, 's_test1').length, 1);
    assert.equal(replay(db2, 's_other').length, 1);
    db2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
