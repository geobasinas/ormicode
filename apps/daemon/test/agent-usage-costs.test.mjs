import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore, createSession } from '@ormicode/session-store';
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
