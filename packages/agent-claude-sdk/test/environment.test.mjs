import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSdkAdapter } from '../src/index.ts';

test('SDK query explicitly inherits the worker environment for its agent and tools', async () => {
  const previous = process.env.ORMI_TEST_SECRET;
  process.env.ORMI_TEST_SECRET = 'sdk-test-value';
  const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
    assert.equal(options.env.ORMI_TEST_SECRET, 'sdk-test-value');
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 };
  })() });
  const handle = await adapter.start({ cwd: '/repo' });
  try {
    const events = adapter.events(handle);
    await adapter.prompt(handle, { text: 'test environment' });
    for await (const event of events) { if (event.kind === 'error') assert.fail(event.message); if (event.kind === 'turn_end') break; }
  } finally {
    await adapter.dispose(handle);
    if (previous === undefined) delete process.env.ORMI_TEST_SECRET; else process.env.ORMI_TEST_SECRET = previous;
  }
});
