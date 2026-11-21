import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';

const pendingCleanup = new Set();
const projectDir = mkdtempSync(join(tmpdir(), 'ormi-daemon-project-'));
test.after(async () => {
  for (const cleanup of pendingCleanup) await cleanup();
  rmSync(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
});

const boot = async (env = {}) => {
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const dir = mkdtempSync(join(tmpdir(), 'ormi-daemon-test-'));
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    pendingCleanup.delete(cleanup);
    try { client.close(); await daemon.close(); }
    finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  pendingCleanup.add(cleanup);
  return { daemon, client, cleanup };
};

test('vendor modes and config options reach session.get from the worker ready frame', async () => {
  const { client, cleanup } = await boot({
    ORMICODE_FAKE_MODES: JSON.stringify([{ id: 'ask', name: 'Ask' }, { id: 'auto-approve', name: 'Auto-approve' }]),
    ORMICODE_FAKE_OPTIONS: JSON.stringify([{ id: 'approval', category: 'permission', name: 'Approval', current: 'ask', choices: [{ value: 'ask', name: 'Ask' }, { value: 'auto-approve', name: 'Auto' }] }]),
  });
  try {
    const res = await client.request('session.start', { machine: newId('m'), project: projectDir, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
    assert.equal(res.type, 'res', JSON.stringify(res));
    const session = res.body.session;
    const deadline = Date.now() + 15_000;
    let got;
    while (Date.now() < deadline) {
      const answer = await client.request('session.get', { session });
      got = answer.type === 'res' ? answer.body : undefined;
      if (got?.modes?.length) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.deepEqual(got?.modes, [{ id: 'ask', name: 'Ask' }, { id: 'auto-approve', name: 'Auto-approve' }]);
    assert.equal(got?.options?.[0]?.id, 'approval');
    assert.equal(got?.options?.[0]?.current, 'ask');
  } finally { await cleanup(); }
});
