import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexCliAdapter } from '@ormicode/agent-codex-cli';
import { openStore, createSession, getSession, setState } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { summarize } from '@ormicode/digest';
import { stateFor } from '../src/supervisor-state.ts';
import { needsAttention } from '../../../packages/client-ui/src/features/session/attention.ts';

for (const option of ['accept', 'decline']) test(`Codex CLI ${option} decisions clear journaled user approvals from Needs You`, async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'child', machine: 'm', project: '/repo', cwd: '/repo', vendor: 'codex', transport: 'cli' });
  const fixture = fileURLToPath(new URL('../../../packages/agent-codex-cli/test/fixtures/app-server.mjs', import.meta.url));
  const adapter = new CodexCliAdapter({ spawn: (_cmd, _args, options) => spawn(process.execPath, [fixture], options) });
  const handle = await adapter.start({ cwd: '/repo' }); t.after(() => adapter.dispose(handle));
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  const next = async () => {
    const { value: event } = await stream.next();
    append(db, 'child', { kind: event.kind, payload: event });
    if (stateFor[event.kind]) setState(db, 'child', stateFor[event.kind]);
    return event;
  };
  const digest = () => summarize({ id: 'child', state: getSession(db, 'child').state, updatedAt: 0 }, replay(db, 'child').map(e => ({ ...e, payload: JSON.parse(e.payload) })), 0);
  await adapter.prompt(handle, { text: 'approve me' });
  let event;
  do { event = await next(); } while (event.kind !== 'approval_request');
  const request = event.request;
  assert.equal(digest().wants.kind, 'approval');
  assert.equal(needsAttention(getSession(db, 'child'), digest()), true);
  await adapter.approve(handle, request, option);
  assert.deepEqual(await next(), { kind: 'approval_decision', request, option });
  assert.equal(digest().wants, null);
  assert.equal(needsAttention(getSession(db, 'child'), digest()), false);
  while ((await next()).kind !== 'turn_end') {}
  assert.equal(digest().wants, null);
  assert.equal(needsAttention(getSession(db, 'child'), digest()), false);
  assert.equal(replay(db, 'child').filter(e => e.kind === 'approval_decision').length, 1);
});
