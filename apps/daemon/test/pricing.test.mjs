import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { createSession, getPinnedPrice } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';

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

test('session.cost keeps the first estimated price and version after refresh', async () => {
  let inputPrice = '0.000003';
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'anthropic/claude-sonnet-4.6', pricing: { prompt: inputPrice, completion: '0.000015' } }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'ormi-price-pin-'));
  const previous = { home: process.env.ORMICODE_HOME, prices: process.env.ORMICODE_PRICES_URL };
  Object.assign(process.env, { ORMICODE_HOME: join(dir, 'home'), ORMICODE_PRICES_URL: `http://127.0.0.1:${server.address().port}/models` });
  let daemon; let client;
  try {
    daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
    client = await connect(daemon.socketPath);
    const session = newId('s');
    createSession(daemon.db, { id: session, machine: 'm_local', project: '/repo', vendor: 'fake', transport: 'cli', model: 'claude-sonnet-4-6', cwd: '/repo' });
    append(daemon.db, session, { kind: 'usage', payload: { input: 1_000_000, output: 0 } });
    const first = await client.request('session.cost', { session });
    inputPrice = '0.000009';
    await client.request('pricing.refresh', {});
    const second = await client.request('session.cost', { session });
    assert.deepEqual([first.body.usd, first.body.source], [3, 'estimate']);
    assert.deepEqual([second.body.usd, second.body.priceVersion], [first.body.usd, first.body.priceVersion]);
    assert.notEqual((await client.request('pricing.status', {})).body.version, first.body.priceVersion);
    assert.equal(getPinnedPrice(daemon.db, session, 'claude-sonnet-4-6').version, first.body.priceVersion);
  } finally {
    client?.close();
    await daemon?.close();
    await new Promise(resolve => server.close(resolve));
    if (previous.home === undefined) delete process.env.ORMICODE_HOME; else process.env.ORMICODE_HOME = previous.home;
    if (previous.prices === undefined) delete process.env.ORMICODE_PRICES_URL; else process.env.ORMICODE_PRICES_URL = previous.prices;
  }
});

test('cost.totals groups priced and unpriced usage by project, day and session', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'anthropic/claude-sonnet-4.6', pricing: { prompt: '0.000003', completion: '0.000015' } }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'ormi-cost-totals-'));
  const previous = { home: process.env.ORMICODE_HOME, prices: process.env.ORMICODE_PRICES_URL };
  Object.assign(process.env, { ORMICODE_HOME: join(dir, 'home'), ORMICODE_PRICES_URL: `http://127.0.0.1:${server.address().port}/models` });
  let daemon; let client;
  try {
    daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
    client = await connect(daemon.socketPath);
    const day1 = new Date(2025, 0, 1, 12).getTime();
    const day2 = new Date(2025, 0, 2, 12).getTime();
    const first = newId('s'); const second = newId('s');
    createSession(daemon.db, { id: first, machine: 'm_local', project: '/repos/alpha', vendor: 'fake', transport: 'cli', model: 'claude-sonnet-4-6', cwd: '/repos/alpha' });
    createSession(daemon.db, { id: second, machine: 'm_local', project: '/repos/beta', vendor: 'fake', transport: 'cli', model: 'unknown-model', cwd: '/repos/beta' });
    append(daemon.db, first, { kind: 'usage', ts: day1, payload: { input: 1_000_000 } });
    append(daemon.db, first, { kind: 'usage', ts: day2, payload: { output: 100 } });
    append(daemon.db, second, { kind: 'usage', ts: day2, payload: { input: 50, output: 50 } });
    const result = await client.request('cost.totals', { since: day1 });
    const body = result.body;
    assert.deepEqual(body.total, { tokens: 1_000_200, usd: 3.0015, unpriced: 1, estimate: true });
    assert.deepEqual(body.projects.map(p => [p.project, p.tokens, p.usd, p.unpriced, p.estimate]), [
      ['/repos/alpha', 1_000_100, 3.0015, 0, true], ['/repos/beta', 100, null, 1, false],
    ]);
    assert.deepEqual(body.days.map(d => [d.date, d.tokens, d.usd, d.unpriced, d.estimate]), [
      [localDate(day1), 1_000_000, 3, 0, true], [localDate(day2), 200, 0.0015, 1, true],
    ]);
    assert.deepEqual(body.sessions.map(s => [s.project, s.tokens, s.usd, s.unpriced, s.estimate]).sort(([a], [b]) => a.localeCompare(b)), [
      ['/repos/alpha', 1_000_100, 3.0015, 0, true], ['/repos/beta', 100, null, 1, false],
    ]);
  } finally {
    client?.close();
    await daemon?.close();
    await new Promise(resolve => server.close(resolve));
    if (previous.home === undefined) delete process.env.ORMICODE_HOME; else process.env.ORMICODE_HOME = previous.home;
    if (previous.prices === undefined) delete process.env.ORMICODE_PRICES_URL; else process.env.ORMICODE_PRICES_URL = previous.prices;
  }
});

function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
