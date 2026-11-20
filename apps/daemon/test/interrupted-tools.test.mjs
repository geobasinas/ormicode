import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { closeInterruptedTools } from '../src/interrupted-tools.ts';

test('interruption durably closes only unfinished calls, including nested calls, once', () => {
  const db = openStore(':memory:');
  try {
    for (const id of ['s', 'other']) createSession(db, { id, machine: 'm', project: 'p', vendor: 'claude', transport: 'sdk', cwd: '/repo' });
    const record = (session, kind, payload) => append(db, session, { kind, payload });
    closeInterruptedTools(db, 's', record);
    assert.equal(replay(db, 's').length, 0);
    record('s', 'tool_call', { callId: 'completed', name: 'Read', input: {} });
    record('s', 'tool_result', { callId: 'completed', status: 'completed' });
    record('s', 'tool_call', { callId: 'failed', name: 'Read', input: {} });
    record('s', 'tool_result', { callId: 'failed', status: 'failed' });
    record('s', 'tool_call', { callId: 'running', name: 'Bash', input: { command: 'find /' } });
    record('s', 'tool_call', { callId: 'child', name: 'Read', input: {}, parent: 'running' });
    record('other', 'tool_call', { callId: 'other', name: 'Bash', input: {} });
    closeInterruptedTools(db, 's', record);
    closeInterruptedTools(db, 's', record);
    const results = replay(db, 's').filter(e => e.kind === 'tool_result').map(e => JSON.parse(e.payload));
    assert.deepEqual(results, [
      { callId: 'completed', status: 'completed' }, { callId: 'failed', status: 'failed' },
      { callId: 'running', status: 'interrupted' }, { callId: 'child', status: 'interrupted', parent: 'running' },
    ]);
    assert.equal(replay(db, 'other').length, 1);
  } finally { db.close(); }
});
