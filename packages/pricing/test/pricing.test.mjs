import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN, loadTable, priceFor, summarize } from '../src/index.ts';

test('priceFor matches dated ids by prefix and refuses unknown models', () => {
  assert.equal(priceFor(BUILTIN, 'claude-sonnet-4-20250514').input, 3);
  assert.equal(priceFor(BUILTIN, 'gpt-5-mini').output, 2);
  assert.equal(priceFor(BUILTIN, 'mystery-1'), undefined);
  assert.equal(priceFor(BUILTIN, null), undefined);
});

test('summarize estimates from list price, prefers reported cost, and never guesses', () => {
  const ev = (kind, payload = {}) => ({ kind, payload });
  const est = summarize([ev('usage', { input: 1_000_000, output: 100_000 }), ev('turn_end')], 'claude-sonnet-4', BUILTIN);
  assert.deepEqual([est.usd, est.source, est.turns, est.priceVersion], [4.5, 'estimate', 1, BUILTIN.version]);
  const rep = summarize([ev('usage', { input: 10, costUsd: 0.25 })], 'mystery', BUILTIN);
  assert.deepEqual([rep.usd, rep.source, rep.input], [0.25, 'reported', 10]);
  const none = summarize([ev('usage', { input: 10 })], 'mystery', BUILTIN);
  assert.deepEqual([none.usd, none.source], [null, 'none']);
});

test('loadTable merges hand edits over the built-in table', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'ormi-price-')), 'prices.json');
  writeFileSync(p, JSON.stringify({ version: 'mine-1', models: { 'my-model': { input: 1, output: 2 } } }));
  const t = loadTable(p);
  assert.equal(t.version, 'mine-1'); assert.equal(priceFor(t, 'my-model').output, 2); assert.ok(priceFor(t, 'gpt-5'));
  assert.equal(loadTable(join(p, 'missing')).version, BUILTIN.version);
});
