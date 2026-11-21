import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';

test('settings.get lists live keys with defaults; settings.set validates, persists, applies and resets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-settings-'));
  process.env.ORMICODE_HOME = join(dir, 'home');
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  try {
    const listed = (await client.request('settings.get', {})).body;
    assert.equal(listed.profile, 'laptop');
    const cap = listed.settings.find(s => s.key === 'pool.cap');
    assert.deepEqual(cap, { key: 'pool.cap', value: 20, default: 20, set: false, min: 1, max: 64 });
    const agent = listed.settings.find(s => s.key === 'utility.agent');
    assert.ok(agent.choices.includes('default') && agent.choices.includes('claude/cli') && !agent.choices.some(c => c.startsWith('fake')));

    assert.equal((await client.request('settings.set', { key: 'pool.cap', value: 0 })).code, 'protocol.invalid_frame');
    assert.equal((await client.request('settings.set', { key: 'pool.cap', value: 2.5 })).code, 'protocol.invalid_frame');
    assert.equal((await client.request('settings.set', { key: 'nope', value: 1 })).code, 'protocol.invalid_frame');
    assert.equal((await client.request('settings.set', { key: 'utility.agent', value: 'nobody/cli' })).code, 'protocol.invalid_frame');

    assert.deepEqual((await client.request('settings.set', { key: 'pool.cap', value: 3 })).body, { key: 'pool.cap', value: 3, default: 20, set: true, min: 1, max: 64 });
    assert.equal((await client.request('daemon.status', {})).body.pool.cap, 3);
    assert.equal((await client.request('settings.set', { key: 'utility.agent', value: 'codex/cli' })).body.value, 'codex/cli');

    assert.equal((await client.request('settings.set', { key: 'pool.cap', value: null })).body.set, false);
    assert.equal((await client.request('daemon.status', {})).body.pool.cap, 20);
  } finally {
    await daemon.close();
    delete process.env.ORMICODE_HOME;
  }
});
