import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromOpenRouter, normalizeModel, priceFor, summarize, PriceBook, EMPTY } from '../src/index.ts';

const OR = { data: [
  { id: 'anthropic/claude-sonnet-4.6', canonical_slug: 'anthropic/claude-4.6-sonnet-20260217', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' } },
  { id: 'anthropic/claude-sonnet-4.6:batch', pricing: { prompt: '0.0000015', completion: '0.0000075' } },
  { id: 'openai/gpt-5.4-mini', canonical_slug: 'openai/gpt-5.4-mini-20260317', pricing: { prompt: '0.00000075', completion: '0.0000045', input_cache_read: '0.000000075' } },
  { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
  { id: 'some/free-model', pricing: { prompt: '0', completion: '0' } },
] };

test('normalizeModel lines up OpenRouter ids with what agents report', () => {
  assert.equal(normalizeModel('anthropic/claude-sonnet-4.6'), 'claude-sonnet-4-6');
  assert.equal(normalizeModel('claude-sonnet-4-6-20260217'), 'claude-sonnet-4-6');
  assert.equal(normalizeModel('openai/gpt-5.4-mini:batch'), 'gpt-5-4-mini');
});

test('fromOpenRouter converts per-token strings to per-million and skips variants and non-prices', () => {
  const t = fromOpenRouter(OR);
  assert.deepEqual(priceFor(t, 'claude-sonnet-4-6-20260217'), { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  assert.deepEqual(priceFor(t, 'gpt-5.4-mini'), { input: 0.75, output: 4.5, cacheRead: 0.075 });
  assert.ok(priceFor(t, 'claude-4.6-sonnet'));
  assert.equal(priceFor(t, 'auto'), undefined);
  assert.equal(priceFor(t, 'free-model'), undefined);
  assert.equal(priceFor(t, 'claude-sonnet-4-7'), undefined);
  assert.match(t.version, /^openrouter-[0-9a-f]{8}$/);
  assert.equal(fromOpenRouter(OR).version, t.version);
  assert.throws(() => fromOpenRouter({ nope: 1 }), /unexpected/);
});

test('summarize estimates from the fetched price, prefers reported cost, and never guesses', () => {
  const t = fromOpenRouter(OR);
  const ev = (kind, payload = {}) => ({ kind, payload });
  const est = summarize([ev('usage', { input: 1_000_000, output: 100_000 }), ev('turn_end')], 'claude-sonnet-4-6', t);
  assert.deepEqual([est.usd, est.source, est.turns, est.priceVersion], [4.5, 'estimate', 1, t.version]);
  const rep = summarize([ev('usage', { input: 10, costUsd: 0.25 })], 'mystery', EMPTY);
  assert.deepEqual([rep.usd, rep.source], [0.25, 'reported']);
  assert.deepEqual([summarize([ev('usage', { input: 10 })], 'claude-sonnet-4-6', EMPTY).usd], [null]);
});

test('PriceBook fetches once, caches for maxAge, survives failures and applies hand edits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-price-'));
  let now = 1000; let calls = 0; let fail = false;
  const fetchImpl = async () => { calls++; if (fail) throw new Error('offline'); return { ok: true, status: 200, json: async () => OR }; };
  const opts = { cachePath: join(dir, 'cache', 'prices.json'), overridesPath: join(dir, 'prices.json'), maxAgeMs: 100, fetch: fetchImpl, now: () => now };
  const book = new PriceBook(opts);
  assert.equal(book.status().source, 'none');
  await Promise.all([book.ensure(), book.ensure()]);
  assert.deepEqual([calls, book.status().source, book.status().models > 0, existsSync(opts.cachePath)], [1, 'openrouter', true, true]);
  await book.ensure(); assert.equal(calls, 1);
  now += 200; fail = true; await book.ensure();
  assert.deepEqual([calls, book.status().error, priceFor(book.table(), 'gpt-5-4-mini').input], [2, 'offline', 0.75]);
  const fromCache = new PriceBook({ ...opts, url: null });
  await fromCache.ensure();
  assert.equal(fromCache.status().source, 'cache');
  writeFileSync(opts.overridesPath, JSON.stringify({ models: { 'my/model-1.0': { input: 1, output: 2 } } }));
  assert.equal(priceFor(fromCache.table(), 'model-1-0').output, 2);
  assert.match(fromCache.table().version, /\+manual$/);
});
