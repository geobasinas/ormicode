import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, getSession, setState, setNativeId } from '../../../packages/session-store/src/index.ts';
import { append, replay } from '../../../packages/journal/src/index.ts';
import { recoverSessions } from '../src/recovery.ts';

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'recovery-'));
  const db = openStore(join(dir, 'store.db'));
  return { db, dir };
};

test('boot interrupts in-flight sessions and expires pending approvals', () => {
  const { db, dir } = setup();
  try {
    createSession(db, { id: 's_a', machine: 'm', project: 'p', vendor: 'fake', transport: 'cli', cwd: '/tmp' });
    setState(db, 's_a', 'awaiting_approval');
    append(db, 's_a', { kind: 'approval_request', payload: { kind: 'approval_request', id: 'req_01' } });
    setState(db, 's_a', 'awaiting_approval');
    const { autoResume: candidates } = recoverSessions(db, 'safe');
    assert.equal(candidates.length, 0);
    const s = getSession(db, 's_a');
    assert.equal(s.state, 'interrupted');
    assert.equal(s.reason, 'host_restart');
    const kinds = replay(db, 's_a').map(r => r.kind);
    assert.ok(kinds.includes('interaction_expired'), 'pending approval expired');
    assert.ok(kinds.includes('interrupted'), 'host_restart recorded');
    assert.equal(JSON.parse(replay(db, 's_a').find(r => r.kind === 'interaction_expired').payload).id, 'req_01');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('safe policy resumes only completed sessions with a resumable transport', () => {
  const { db, dir } = setup();
  try {
    createSession(db, { id: 's_done', machine: 'm', project: 'p', vendor: 'pi', transport: 'cli', cwd: '/tmp' });
    setState(db, 's_done', 'idle');
    setNativeId(db, 's_done', 'native-1');
    createSession(db, { id: 's_vibecli', machine: 'm', project: 'p', vendor: 'vibe', transport: 'cli', cwd: '/tmp' });
    setState(db, 's_vibecli', 'idle');
    setNativeId(db, 's_vibecli', 'native-2');
    createSession(db, { id: 's_nonative', machine: 'm', project: 'p', vendor: 'pi', transport: 'cli', cwd: '/tmp' });
    setState(db, 's_nonative', 'idle');
    const safe = recoverSessions(db, 'safe').autoResume.map(s => s.id);
    assert.deepEqual(safe, ['s_done']);
    db.close();
    const { db: db2, dir: dir2 } = setup();
    try {
      createSession(db2, { id: 's_intr', machine: 'm', project: 'p', vendor: 'pi', transport: 'cli', cwd: '/tmp' });
      setState(db2, 's_intr', 'interrupted');
      setNativeId(db2, 's_intr', 'native-3');
      assert.deepEqual(recoverSessions(db2, 'safe').autoResume.length, 0, 'safe skips interrupted');
      // interrupted state isn't in the inFlight list, so 'all' picks it up
      assert.deepEqual(recoverSessions(db2, 'all').autoResume.map(s => s.id), ['s_intr']);
      assert.deepEqual(recoverSessions(db2, 'wait').autoResume.length, 0, 'wait resumes nothing');
    } finally { db2.close(); rmSync(dir2, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
