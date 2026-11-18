import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';

test('pricing.* fetches the OpenRouter table once and caches it', async () => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'anthropic/claude-sonnet-4.6', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003' } }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pricing-'));
  Object.assign(process.env, { ORMICODE_HOME: join(dir, 'home'), ORMICODE_PRICES_URL: `http://127.0.0.1:${server.address().port}/api/v1/models` });
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  try {
    const st = await client.request('pricing.status', {});
    assert.deepEqual([st.body.source, st.body.models], ['openrouter', 1]);
    const got = await client.request('pricing.get', { model: 'claude-sonnet-4-6-20260217' });
    assert.deepEqual(got.body.price, { input: 3, output: 15, cacheRead: 0.3 });
    assert.equal((await client.request('pricing.get', { model: 'gpt-unknown' })).body.price, null);
    assert.equal(hits, 1);
    await client.request('pricing.refresh', {});
    assert.equal(hits, 2);
    assert.ok(existsSync(join(dir, 'home', 'cache', 'prices.json')));
  } finally {
    await daemon.close(); server.close();
    delete process.env.ORMICODE_HOME; delete process.env.ORMICODE_PRICES_URL;
  }
});
