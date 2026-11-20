import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexSdkAdapter } from '../src/index.ts';

for (const decision of ['allow', 'deny', 'interrupt']) test(`SDK workspace-write grant: ${decision}`, async () => {
  let executed = 0, options;
  const thread = { runStreamed: async () => { executed++; return { events: (async function* () {
    yield { type: 'thread.started', thread_id: 'native' }; yield { type: 'turn.started' };
    yield { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } };
  })() }; } };
  const adapter = new CodexSdkAdapter({ client: { startThread: opts => { options = opts; return thread; } } });
  const handle = await adapter.start({ cwd: '/repo' });
  try {
    assert.equal(options.sandboxMode, 'workspace-write'); assert.equal(options.approvalPolicy, 'on-request');
    await assert.rejects(adapter.prompt(handle, { text: '' }), /empty/);
    await adapter.prompt(handle, { text: 'edit files' });
    const stream = adapter.events(handle)[Symbol.asyncIterator]();
    assert.equal((await stream.next()).value.kind, 'turn_start');
    const request = (await stream.next()).value;
    assert.equal(request.kind, 'approval_request'); assert.equal(executed, 0);
    await assert.rejects(adapter.approve(handle, request.request, 'unsafe'), /Unknown/);
    if (decision === 'interrupt') await adapter.interrupt(handle);
    else await adapter.approve(handle, request.request, decision);
    for (;;) { const event = (await stream.next()).value; if (['turn_end', 'interrupted'].includes(event.kind)) break; }
    assert.equal(executed, decision === 'allow' ? 1 : 0);
    await assert.rejects(adapter.approve(handle, request.request, 'allow'), /Unknown/);
    await stream.return();
  } finally { await adapter.dispose(handle); }
});
