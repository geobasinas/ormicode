import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GrokAcpAdapter, GrokTurnMapper } from '../src/index.ts';

test('reported prompt usage survives the ACP process round trip exactly once', async () => {
 const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
 const adapter = new GrokAcpAdapter({ spawn: (_cmd, _args, opts) => spawn(process.execPath, [fixture], opts) });
 const handle = await adapter.start({ cwd: process.cwd() });
 try {
  const events = []; const stream = adapter.events(handle);
  await adapter.prompt(handle, { text: 'usage-test' });
  for await (const event of stream) { events.push(event); if (event.kind === 'turn_end') break; }
  assert.deepEqual(events.filter(event => event.kind === 'usage'), [{ kind: 'usage', input: 9, output: 3, cacheRead: 2, cacheWrite: 1, model: 'grok-code-fast-1' }]);
 } finally { await adapter.dispose(handle); }
});
test('usage accepts only Grok whole-prompt metadata, never last-call or guessed counters', () => {
 const finish = value => new GrokTurnMapper('s').finish(value).filter(e => e.kind === 'usage');
 const response = usage => ({ _meta: { inputTokens: 999, outputTokens: 999, modelId: 'last-call', usage } });
 assert.deepEqual(finish(response({ inputTokens: 0, outputTokens: 2 })), [{ kind: 'usage', input: 0, output: 2 }]);
 assert.deepEqual(finish(response({ inputTokens: 100, outputTokens: 10, modelUsage: { a: { inputTokens: 70, outputTokens: 8, cachedReadTokens: 5 }, b: { inputTokens: 30, outputTokens: 2 } } })), [
  { kind: 'usage', model: 'a', input: 65, output: 8, cacheRead: 5 }, { kind: 'usage', model: 'b', input: 30, output: 2 },
 ]);
 for (const value of [undefined, {}, { _meta: { inputTokens: 12, outputTokens: 3 } }, { usage: { inputTokens: 12, outputTokens: 3 } },
  ...[{}, { used: 1200, size: 8000 }, { inputTokens: -1, outputTokens: 2 }, { inputTokens: '12', outputTokens: 2 }, { inputTokens: 1.5, outputTokens: 2 }, { inputTokens: 1, outputTokens: 2, cachedReadTokens: 2 }, { input_tokens: 1, output_tokens: 2 }].map(response),
 ]) assert.deepEqual(finish(value), []);
});
