import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UtilityCalls } from '../src/utility.ts';
import { parseDigestSummary } from '../src/digest-methods.ts';

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); });
const mk = () => { const dir = mkdtempSync(join(tmpdir(), 'ormi-utility-')); dirs.push(dir); return dir; };

/** Minimal adapter: push events on prompt, answer to a queue. */
const stubAdapter = (events = [{ kind: 'turn_start' }, { kind: 'text', text: 'answer' }, { kind: 'turn_end' }]) => ({
  id: 'stub/cli',
  transport: 'cli',
  capabilities: {},
  detect: async () => ({ available: true }),
  models: async () => [],
  start: async () => ({ id: 'h1' }),
  prompt: async () => {},
  events: async function* () { for (const e of events) yield e; },
  dispose: async () => {},
});

const boot = (events, opts = {}) => new UtilityCalls({
  dir: mk(), createAdapter: async () => stubAdapter(events), ...opts,
});

test('utility call returns the collected turn text through an installed agent', async () => {
  const u = boot();
  assert.equal((await u.call('hello'))?.text, 'answer');
});

test('calls are serialized per machine and a timeout kills them', async () => {
  let order = 0;
  const adapter = () => ({
    ...stubAdapter(),
    prompt: async () => order += 1,
    events: async function* () {
      yield { kind: 'turn_start' };
      await new Promise(r => setTimeout(r, order === 1 ? 50 : 30));
      yield { kind: 'text', text: `t${order}` };
      yield { kind: 'turn_end' };
    },
    interrupt: async () => {},
  });
  const u = new UtilityCalls({ dir: mk(), createAdapter: adapter });
  const [a, b] = await Promise.all([u.call('one'), u.call('two')]);
  assert.equal(a.text, 't1');
  assert.equal(b.text, 't2');
});

test('the daily cap blocks calls and spend persists', async () => {
  const dir = mk();
  const u = new UtilityCalls({ dir, createAdapter: async () => stubAdapter(), readSetting: () => 0 });
  assert.equal(await u.call('x'), undefined);
  // Spend recorded against the day: a fresh instance sees the exhausted budget.
  writeFileSync(join(dir, 'utility-spend.json'), JSON.stringify({ day: new Date().toISOString().slice(0, 10), usd: 2 }));
  const broke = new UtilityCalls({ dir, createAdapter: async () => stubAdapter(), readSetting: () => 1 });
  assert.equal(broke.budgetLeft(), 0);
  assert.equal(await broke.call('x'), undefined);
});

test('a dead agent or unparsable reply falls back to undefined, never throws', async () => {
  const u = new UtilityCalls({ dir: mk(), createAdapter: async () => { throw new Error('no agent'); } });
  assert.equal(await u.call('x'), undefined);
});

test('digest summary parsing keeps mechanical facts and swaps prose', () => {
  const mech = {
    session: 's1', rank: 'waiting', source: 'mechanical',
    changed: { paths: ['a.ts', 'b.ts'], result: 'last text' },
    wants: { kind: 'approval', since: 5 }, dropped: ['Bash failed'],
    where: { state: 'awaiting_approval', ageMs: 100 }, cost: { tokens: 42 },
  };
  const out = parseDigestSummary('noise [{ "session": "s1", "result": "wrote helpers", "dropped": [] }] tail', [mech]);
  assert.equal(out.length, 1);
  const entry = out[0].entry;
  assert.equal(entry.source, 'summary');
  assert.equal(entry.changed.result, 'wrote helpers');
  assert.deepEqual(entry.changed.paths, ['a.ts', 'b.ts']);
  assert.deepEqual(entry.dropped, []);
  assert.deepEqual(entry.wants, mech.wants);
  assert.equal(entry.cost.tokens, 42);
  assert.equal(parseDigestSummary('not json', [mech]).length, 0);
  assert.equal(parseDigestSummary('[{"session":"other","result":"x"}]', [mech]).length, 0);
});
