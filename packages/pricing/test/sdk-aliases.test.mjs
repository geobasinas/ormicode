import test from 'node:test';
import assert from 'node:assert/strict';
import { fromOpenRouter, priceFor, summarize } from '../src/index.ts';
import { mapSdkMessage } from '../../agent-claude-sdk/src/map.ts';

const table = fromOpenRouter({ data: [
 { id: 'anthropic/claude-3.5-sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
 { id: 'openai/codex-mini', pricing: { prompt: '0.0000015', completion: '0.000006' } },
] });
test('SDK model aliases resolve only to the same priced model, including provider forms', () => {
 for (const id of ['claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest', 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', 'claude-3-5-sonnet-v2@20241022']) assert.equal(priceFor(table, id).input, 3);
 assert.equal(priceFor(table, 'codex-mini-latest').input, 1.5);
 for (const id of ['claude-sonnet-4-7', 'sonnet', 'gpt-5.4-codex', '']) assert.equal(priceFor(table, id), undefined);
});
test('reported-model pins survive an unavailable current table and identify mixed versions', () => {
 const pins = new Map(['codex-mini-latest', 'claude-3-5-sonnet-20241022'].map(model =>
  [model, { price: priceFor(table, model), version: model }]));
 const events = [...pins.keys()].map(model => ({ kind: 'usage', payload: { model, input: 1_000_000 } }));
 events.push({ kind: 'usage', payload: { model: 'unknown-reported-model', costUsd: 2 } });
 const cost = summarize(events, null, fromOpenRouter({ data: [] }), undefined, model => pins.get(model));
 assert.equal(cost.usd, 6.5); assert.equal(cost.source, 'estimate'); assert.equal(cost.priceVersion, 'mixed');
 assert.equal(summarize([{ kind: 'usage', payload: { model: 'unknown', input: 1 } }], null, table, undefined, model => pins.get(model)).usd, null);
 assert.equal(summarize([], null, table, undefined, model => pins.get(model)).usd, null);
});
test('Claude reported model can price SDK rows even when the selected session model is default', () => {
 const mapped = mapSdkMessage({ type: 'result', subtype: 'success', usage: { input_tokens: 1_000_000, output_tokens: 0 }, total_cost_usd: 3, modelUsage: { 'claude-3-5-sonnet-20241022': {} } });
 const events = mapped.events.map(({ kind, ...payload }) => ({ kind, payload }));
 const cost = summarize(events, 'default', table);
 assert.equal(cost.usd, 3); assert.equal(cost.source, 'estimate');
 assert.equal(summarize([{ kind: 'usage', payload: { input: 1, model: 'unknown' } }], 'codex-mini', table).usd, null);
});
