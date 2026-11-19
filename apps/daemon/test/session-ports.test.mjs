import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, getSessionPorts } from '@ormicode/session-store';
import { allocateSessionPorts } from '../src/session-ports.ts';
import { sessionEnvironment } from '../src/session-env.ts';

test('port allocation is aligned, unique, and stable across store reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-port-allocation-'));
  let db;
  try {
    const base = Math.ceil((20_000 + Math.floor(Math.random() * 30_000)) / 10) * 10;
    const range = `${base}-${base + 39}`;
    db = openStore(join(dir, 'store.db'));
    const one = await allocateSessionPorts(db, 's_one', range);
    const two = await allocateSessionPorts(db, 's_two', range);
    assert.equal(one.count, 10);
    assert.equal(one.base % 10, 0);
    assert.notEqual(one.base, two.base);
    db.close();
    db = openStore(join(dir, 'store.db'));
    assert.deepEqual(await allocateSessionPorts(db, 's_one', 'invalid'), one);
    assert.equal(getSessionPorts(db, 's_two'), two.base);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session environment uses the session root for scratch workspaces', () => {
  assert.deepEqual(sessionEnvironment({
    session: 's_env', project: 'scratch', cwd: '/tmp/scratch/s_env',
    base: 41020, branch: null,
  }), {
    PORT: '41020', ORMI_PORT: '41020', ORMI_PORTS: '41020-41029',
    ORMI_SESSION: 's_env', ORMI_WORKTREE: '/tmp/scratch/s_env',
    ORMI_PROJECT_ROOT: '/tmp/scratch/s_env', ORMI_BRANCH: '',
  });
});
