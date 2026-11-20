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
  assert.deepEqual(events.filter(event => event.kind === 'usage'), [{ kind: 'usage', input: 12, output: 3, cacheRead: 2, model: 'x-ai/grok-code-fast-1' }]);
 } finally { await adapter.dispose(handle); }
});
test('usage accepts zero and snake-case counters but never invents tokens from context size or malformed reports', () => {
 const finish = value => new GrokTurnMapper('s').finish(value).filter(e => e.kind === 'usage');
 assert.deepEqual(finish({ input_tokens: 0, output_tokens: 2 }), [{ kind: 'usage', input: 0, output: 2 }]);
 for (const value of [undefined, {}, { used: 1200, size: 8000 }, { inputTokens: -1 }, { inputTokens: '12' }]) assert.deepEqual(finish(value), []);
});
