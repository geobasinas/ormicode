import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GrokInteractiveCliAdapter } from '@ormicode/agent-grok-acp';
import { createAdapter } from '../src/registry.ts';

test('worker registry selects permission-capable Grok CLI rather than headless dontAsk', async () => {
  const adapter = await createAdapter('grok', 'cli', {});
  assert.ok(adapter instanceof GrokInteractiveCliAdapter);
  assert.equal(adapter.transport, 'cli'); assert.equal(adapter.capabilities.approvals, true);
});
for (const option of ['allow', 'deny']) test(`Grok CLI forwards ${option} through agent stdio without automatic approval flags`, async () => {
  const fixture = fileURLToPath(new URL('../../../packages/agent-grok-acp/test/fixture.mjs', import.meta.url));
  const adapter = new GrokInteractiveCliAdapter({ spawn: (_cmd, args, options) => {
    assert.deepEqual(args, ['--no-auto-update', 'agent', 'stdio']);
    return spawn(process.execPath, [fixture], options);
  } });
  const handle = await adapter.start({ cwd: process.cwd() });
  try {
    const events = adapter.events(handle); let requests = 0;
    await adapter.prompt(handle, { text: option === 'allow' ? 'approval-allow' : 'approval-test' });
    for await (const event of events) {
      if (event.kind === 'approval_request') { requests++; await assert.rejects(adapter.approve(handle, event.request, 'bad'), /Unknown/); await adapter.approve(handle, event.request, option); }
      if (event.kind === 'error' || event.kind === 'interrupted') assert.fail(JSON.stringify(event));
      if (event.kind === 'turn_end') break;
    }
    assert.equal(requests, 1);
  } finally { await adapter.dispose(handle); }
});
