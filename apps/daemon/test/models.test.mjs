import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';

async function withDaemon(modelsEnv, run) {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-models-'));
  const previous = { home: process.env.ORMICODE_HOME, models: process.env.ORMICODE_FAKE_MODELS };
  process.env.ORMICODE_HOME = join(dir, 'home');
  if (modelsEnv === undefined) delete process.env.ORMICODE_FAKE_MODELS;
  else process.env.ORMICODE_FAKE_MODELS = modelsEnv;
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  try { await run({ daemon, client, home: process.env.ORMICODE_HOME }); }
  finally {
    client.close();
    await daemon.close();
    if (previous.home === undefined) delete process.env.ORMICODE_HOME; else process.env.ORMICODE_HOME = previous.home;
    if (previous.models === undefined) delete process.env.ORMICODE_FAKE_MODELS; else process.env.ORMICODE_FAKE_MODELS = previous.models;
  }
}

test('models.list returns fake models, caches them, and refresh bypasses the cache', async () => {
  const initial = JSON.stringify([
    { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', efforts: ['low', 'high'] },
    { id: 'gpt-x', name: 'Unavailable one', available: false, reason: 'not enabled' },
  ]);
  await withDaemon(initial, async ({ client, home }) => {
    const first = await client.request('models.list', { agent: 'fake' });
    assert.equal(first.type, 'res');
    assert.deepEqual(first.body.models.map(({ agent, transport, id, label, efforts, available, reason }) => ({ agent, transport, id, label, efforts, available, reason })), [
      { agent: 'fake', transport: 'cli', id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['low', 'high'], available: true, reason: undefined },
      { agent: 'fake', transport: 'cli', id: 'gpt-x', label: 'Unavailable one', efforts: [], available: false, reason: 'not enabled' },
    ]);
    const cached = await client.request('models.list', { agent: 'fake' });
    assert.equal(cached.body.models[0].cachedAt, first.body.models[0].cachedAt);

    process.env.ORMICODE_FAKE_MODELS = JSON.stringify([{ id: 'refreshed-model' }]);
    const refreshed = await client.request('models.list', { agent: 'fake', refresh: true });
    assert.deepEqual(refreshed.body.models.map(model => model.id), ['refreshed-model']);
    assert.ok(existsSync(join(home, 'cache', 'models.json')));
    const refreshedCache = await client.request('models.list', { agent: 'fake' });
    assert.equal(refreshedCache.body.models[0].cachedAt, refreshed.body.models[0].cachedAt);
  });
});

test('models.list returns adapter errors without failing the request', async () => {
  await withDaemon('{not-json', async ({ client }) => {
    const result = await client.request('models.list', { agent: 'fake' });
    assert.equal(result.type, 'res');
    assert.deepEqual(result.body.models, []);
    assert.deepEqual(result.body.errors.map(({ agent, transport }) => ({ agent, transport })), [{ agent: 'fake', transport: 'cli' }]);
    assert.match(result.body.errors[0].message, /JSON/);
  });
});
