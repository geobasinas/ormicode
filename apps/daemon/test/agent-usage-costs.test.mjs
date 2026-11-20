import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore, createSession, getPinnedPrice } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { fromOpenRouter } from '@ormicode/pricing';
import { GrokTurnMapper } from '@ormicode/agent-grok-acp';
import { mapSdkMessage } from '@ormicode/agent-claude-sdk';
import { costMethod } from '../src/cost-methods.ts';

test('header and Settings usage price Codex/Claude aliases and journaled Grok ACP usage', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'agent-costs-')); const db = openStore(join(dir, 'store.db'));
 const table = fromOpenRouter({ data: [
  { id: 'openai/codex-mini', pricing: { prompt: '0.0000015', completion: '0.000006' } },
  { id: 'anthropic/claude-3.5-sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'x-ai/grok-code-fast-1', pricing: { prompt: '0.0000002', completion: '0.0000015' } },
 ] });
 const ctx = { db, prices: { ensure: async () => {}, table: () => table } };
 let result; const client = { link: { reply: (_id, body) => { result = body; } } };
 try {
  const claude = mapSdkMessage({ type: 'result', subtype: 'success', usage: { input_tokens: 1_000_000, output_tokens: 0 }, total_cost_usd: 3, modelUsage: { 'claude-3-5-sonnet-20241022': {} } }).events.find(e => e.kind === 'usage');
  const grok = new GrokTurnMapper('native').finish({ _meta: { usage: { modelUsage: { 'grok-code-fast-1': { inputTokens: 1_000_000, outputTokens: 0 } } } } }).find(e => e.kind === 'usage');
  for (const [id, vendor, transport, model, usage, usd] of [
   ['s_codex', 'codex', 'sdk', 'codex-mini-latest', { input: 1_000_000 }, 1.5],
   ['s_claude', 'claude', 'sdk', null, claude, 3], ['s_grok', 'grok', 'acp', null, grok, 0.2],
  ]) {
   createSession(db, { id, machine: 'm', project: 'p', vendor, transport, model, cwd: dir });
   append(db, id, { kind: 'usage', payload: usage });
   await costMethod(ctx, client, 'header', 'session.cost', { session: id });
   assert.equal(result.usd, usd); assert.equal(result.source, 'estimate');
  }
  await costMethod(ctx, client, 'settings', 'cost.totals', {});
  assert.equal(result.total.usd, 4.7); assert.equal(result.total.tokens, 3_000_000); assert.equal(result.total.unpriced, 0);
  assert.equal(result.sessions.length, 3);
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('reported-model estimates persist across refresh and restart for headers and every totals bucket', async t => {
 const dir = mkdtempSync(join(tmpdir(), 'reported-price-pin-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
 const path = join(dir, 'store.db'); let db = openStore(path); t.after(() => db.close());
 const old = fromOpenRouter({ data: [{ id: 'x-ai/grok-code-fast-1', pricing: { prompt: '0.0000002', completion: '0.0000015' } }] });
 const refreshed = fromOpenRouter({ data: [{ id: 'x-ai/grok-code-fast-1', pricing: { prompt: '0.0000001', completion: '0.000001' } }] });
 let table = old;
 const ctx = { db, prices: { ensure: async () => {}, table: () => table } };
 let result; const client = { link: { reply: (_id, body) => { result = body; } } };
 for (const [id, model] of [['default', null], ['different', 'codex-mini-latest']]) {
  createSession(db, { id, model, machine: 'm', project: 'p', vendor: 'grok', transport: 'acp', cwd: dir });
  append(db, id, { kind: 'usage', payload: { model: 'grok-code-fast-1', input: 1_000_000 } });
 }
 await costMethod(ctx, client, 'first-read', 'cost.totals', {});
 assert.equal(result.total.usd, 0.4);
 assert.equal(getPinnedPrice(db, 'default', 'grok-code-fast-1').version, old.version);
 table = refreshed; db.close(); db = openStore(path); ctx.db = db;
 for (const session of ['default', 'different']) {
  await costMethod(ctx, client, 'header', 'session.cost', { session });
  assert.equal(result.usd, 0.2); assert.equal(result.priceVersion, old.version);
 }
 await costMethod(ctx, client, 'settings', 'cost.totals', {});
 assert.equal(result.total.usd, 0.4);
 assert.equal(result.projects[0].usd, 0.4); assert.equal(result.days[0].usd, 0.4);
 assert.deepEqual(result.sessions.map(row => row.usd), [0.2, 0.2]);
 await costMethod(ctx, client, 'range', 'cost.totals', { since: Date.now() + 1000 });
 assert.equal(result.total.usd, null); assert.deepEqual(result.sessions, []);
});
