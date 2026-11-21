import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore, createSession } from '../../../packages/session-store/src/index.ts';
import { append } from '../../../packages/journal/src/index.ts';
import { shouldRecordResume } from '../src/resume-marker.ts';

test('idle restarts do not journal another resume until activity intervenes', () => {
  const db = openStore(':memory:');
  try {
    createSession(db, { id: 's_resume', machine: 'm', project: 'p', vendor: 'claude', transport: 'sdk', cwd: '/repo' });
    assert.equal(shouldRecordResume(db, 's_resume'), true);
    append(db, 's_resume', { kind: 'resumed', payload: {} });
    assert.equal(shouldRecordResume(db, 's_resume'), false);
    append(db, 's_resume', { kind: 'error', payload: { message: 'failed' } });
    assert.equal(shouldRecordResume(db, 's_resume'), true);
    append(db, 's_resume', { kind: 'prompt', payload: { text: 'again' } });
    assert.equal(shouldRecordResume(db, 's_resume'), true);
  } finally { db.close(); }
});

test('hidden bookkeeping events between restarts do not unlock another resume', () => {
  const db = openStore(':memory:');
  try {
    createSession(db, { id: 's_hidden', machine: 'm', project: 'p', vendor: 'claude', transport: 'sdk', cwd: '/repo' });
    append(db, 's_hidden', { kind: 'resumed', payload: {} });
    for (const kind of ['evicted', 'usage', 'state', 'agent_version', 'turn_start', 'turn_end']) {
      append(db, 's_hidden', { kind, payload: kind === 'state' ? { state: 'idle' } : {} });
      assert.equal(shouldRecordResume(db, 's_hidden'), false, kind);
    }
    append(db, 's_hidden', { kind: 'text', payload: { text: 'hi' } });
    append(db, 's_hidden', { kind: 'evicted', payload: { reason: 'idle', idleMs: 0 } });
    assert.equal(shouldRecordResume(db, 's_hidden'), true);
  } finally { db.close(); }
});
