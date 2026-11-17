import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, getSession, setState, listSessions } from '../../session-store/src/index.ts';
import { append, replay, outboxSince, getCursor, setCursor, checkTail, crc32c } from '../src/index.ts';

const setup = () => {
  const db = openStore(':memory:');
  createSession(db, { id: 's_test1', machine: 'm_local', project: 'p_app', vendor: 'fake', transport: 'cli', cwd: '/tmp' });
  return db;
};

test('append assigns seq, writes journal + outbox in one tx, bumps last_seq', () => {
  const db = setup();
  const a = append(db, 's_test1', { kind: 'turn_start', payload: { kind: 'turn_start' } });
  const b = append(db, 's_test1', { kind: 'text', payload: { kind: 'text', text: 'hi' } });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(getSession(db, 's_test1')?.last_seq, 2);
  const rows = replay(db, 's_test1');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, 'text');
  assert.match(b.frame, /"seq":2/);
  assert.equal(outboxSince(db, 's_test1', 1).length, 1);
});

test('replay honors the cursor and cursors persist per device', () => {
  const db = setup();
  append(db, 's_test1', { kind: 'turn_start', payload: { kind: 'turn_start' } });
  append(db, 's_test1', { kind: 'turn_end', payload: { kind: 'turn_end' } });
  assert.equal(replay(db, 's_test1', 1).length, 1);
  setCursor(db, 'd_phone', 's_test1', 1);
  assert.equal(getCursor(db, 'd_phone', 's_test1'), 1);
  assert.equal(getCursor(db, 'd_other', 's_test1'), 0);
});

test('crc32c detects tampering and checkTail drops a torn tail row', () => {
  const db = setup();
  append(db, 's_test1', { kind: 'turn_start', payload: { kind: 'turn_start' } });
  const second = append(db, 's_test1', { kind: 'text', payload: { kind: 'text', text: 'x' } });
  // Simulate a torn tail: corrupt the last row's payload after commit.
  db.prepare("UPDATE events SET payload = '{\"kind\":\"text\",\"text\":\"y\"}' WHERE session = 's_test1' AND seq = ?").run(second.seq);
  const tail = checkTail(db, 's_test1');
  assert.equal(tail.dropped, 1);
  assert.deepEqual(tail.mismatched, [2]);
  assert.equal(replay(db, 's_test1').length, 1);
  assert.equal(outboxSince(db, 's_test1', 0).length, 1);
});

test('crc32c is stable and matches known vectors', () => {
  assert.equal(crc32c(''), 0);
  assert.equal(crc32c('123456789'), 0xE3069283); // standard CRC32C check value
});

test('session CRUD and state transitions', () => {
  const db = setup();
  setState(db, 's_test1', 'running');
  assert.equal(getSession(db, 's_test1')?.state, 'running');
  setState(db, 's_test1', 'interrupted', 'worker_crash');
  const row = getSession(db, 's_test1');
  assert.equal(row?.state, 'interrupted');
  assert.equal(row?.reason, 'worker_crash');
  assert.equal(listSessions(db).length, 1);
  assert.equal(listSessions(db, true).length, 0);
});
