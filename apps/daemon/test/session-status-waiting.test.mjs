import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, getSession, setState } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { ClaudeSdkAdapter } from '@ormicode/agent-claude-sdk';
import { sessionStatus } from '../src/session-status.ts';
import { stateFor } from '../src/supervisor-state.ts';

test('Claude authentication failures remain failed even when input or approval overlays are stale', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'auth', machine: 'm', project: 'p', cwd: '/repo', vendor: 'claude', transport: 'sdk' });
  const ctx = { db, teamApprovals: { waiting: () => true }, teamLifecycle: { state: () => 'awaiting_input' } };
  const adapter = new ClaudeSdkAdapter({ query: () => (async function* () {
    yield { type: 'assistant', error: 'authentication_failed', message: { content: [] } };
  })() });
  const handle = await adapter.start({ cwd: '/repo' }); t.after(() => adapter.dispose(handle));
  await adapter.prompt(handle, { text: 'test' });
  for await (const event of adapter.events(handle)) {
    append(db, 'auth', { kind: event.kind, payload: event });
    if (stateFor[event.kind]) setState(db, 'auth', stateFor[event.kind], event.reason);
    if (event.kind === 'interrupted') break;
  }
  assert.deepEqual(sessionStatus(ctx, getSession(db, 'auth')), { state: 'failed', turnCompleted: false });
  setState(db, 'auth', 'interrupted', 'user_abort');
  assert.equal(sessionStatus(ctx, getSession(db, 'auth')).state, 'interrupted');
  append(db, 'auth', { kind: 'state', payload: { state: 'starting', reason: 'prompt_dispatch' } });
  setState(db, 'auth', 'starting');
  ctx.teamApprovals.waiting = () => false; ctx.teamLifecycle.state = s => s.state;
  assert.equal(sessionStatus(ctx, getSession(db, 'auth')).state, 'starting');
});

test('completed failed turns cannot be reclassified as waiting by stale approval overlays', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'failed', machine: 'm', project: 'p', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  for (const kind of ['turn_start', 'error', 'turn_end']) append(db, 'failed', { kind, payload: { code: 'unknown' } });
  const ctx = { db, teamApprovals: { waiting: () => true }, teamLifecycle: { state: () => 'awaiting_input' } };
  assert.deepEqual(sessionStatus(ctx, getSession(db, 'failed')), { state: 'failed', turnCompleted: true });
});
