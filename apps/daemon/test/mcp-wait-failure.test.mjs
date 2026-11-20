import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore, createSession, getSession, setState } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { ClaudeSdkAdapter } from '@ormicode/agent-claude-sdk';
import { CodexCliAdapter } from '@ormicode/agent-codex-cli';
import { sessionStatus } from '../src/session-status.ts';
import { stateFor } from '../src/supervisor-state.ts';
import { waitFor } from '../src/mcp-wait.ts';

function fixture(t) {
  const db = openStore(':memory:');
  t.after(() => db.close());
  createSession(db, { id: 'child', machine: 'm', project: 'p', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  const ctx = { db, teamApprovals: { waiting: () => false }, teamLifecycle: { state: s => s.state } };
  const status = () => sessionStatus(ctx, getSession(db, 'child'));
  const record = event => {
    append(db, 'child', { kind: event.kind, payload: event });
    if (stateFor[event.kind]) setState(db, 'child', stateFor[event.kind]);
  };
  return { db, record, status };
}

const codexFixture = fileURLToPath(new URL('../../../packages/agent-codex-cli/test/fixtures/app-server.mjs', import.meta.url));
const adapters = {
  claude: () => new ClaudeSdkAdapter({ query: () => (async function* () {
    yield { type: 'result', subtype: 'error_during_execution', errors: ['fixture turn failed'], usage: { input_tokens: 1, output_tokens: 0 }, total_cost_usd: 0 };
  })() }),
  codex: () => new CodexCliAdapter({ spawn: (_cmd, _args, options) => spawn(process.execPath, [codexFixture], options) }),
};

for (const [name, makeAdapter] of Object.entries(adapters)) {
  for (const team of [false, true]) for (const until of ['idle', 'done', 'approval']) {
    test(`${name} failed turn reports authoritative failure for ${team ? 'team' : 'session'} ${until} waits`, async t => {
      const { db, record, status } = fixture(t);
      const adapter = makeAdapter(), handle = await adapter.start({ cwd: '/repo' });
      t.after(() => adapter.dispose(handle));
      setState(db, 'child', 'starting');
      const link = { onFrame: undefined, async request(method) {
        return { type: 'res', body: method === 'session.get' || method === 'team.status' ? status() : {} };
      } };
      const waiting = waitFor(link, 'child', until, 2000, { session: 'parent', token: 'test' }, team);
      await new Promise(resolve => setImmediate(resolve));
      await adapter.prompt(handle, { text: 'fail turn' });
      const received = [];
      for await (const event of adapter.events(handle)) {
        received.push(event.kind);
        record(event);
        link.onFrame?.({ type: 'evt', session: 'child', body: event });
        if (event.kind === 'turn_end') break;
      }
      assert.ok(received.indexOf('error') < received.indexOf('turn_end'));
      assert.ok(received.includes('error'));
      assert.equal(getSession(db, 'child').state, 'idle');
      assert.deepEqual(status(), { state: 'failed', turnCompleted: true });
      assert.deepEqual(JSON.parse(await waiting), { state: 'failed' });
    });
  }
}

test('authoritative turn outcome resets for new work and preserves non-idle states', t => {
  const { db, record, status } = fixture(t);
  assert.deepEqual(status(), { state: 'idle', turnCompleted: false });
  record({ kind: 'turn_start' }); record({ kind: 'error', code: 'unknown', message: 'failed' });
  assert.equal(status().state, 'running');
  record({ kind: 'turn_end' });
  assert.equal(status().state, 'failed');
  for (const state of ['paused_rate_limited', 'interrupted', 'awaiting_approval', 'awaiting_input']) {
    setState(db, 'child', state); assert.equal(status().state, state);
  }
  setState(db, 'child', 'starting'); record({ kind: 'state', state: 'starting', reason: 'prompt_dispatch' });
  assert.deepEqual(status(), { state: 'starting', turnCompleted: false });
  record({ kind: 'turn_start' }); record({ kind: 'turn_end' });
  assert.deepEqual(status(), { state: 'idle', turnCompleted: true });
});
