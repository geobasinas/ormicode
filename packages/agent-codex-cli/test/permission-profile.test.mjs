import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexCliAdapter } from '../src/index.ts';

for (const option of ['accept', 'acceptForSession', 'decline', 'interrupt']) test(`Codex permission-profile schema: ${option}`, async () => {
 const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
 const adapter = new CodexCliAdapter({ spawn: (_cmd, _args, opts) => spawn(process.execPath, [fixture], opts) });
 const handle = await adapter.start({ cwd: '/repo' });
 try {
  const events = adapter.events(handle);
  await adapter.prompt(handle, { text: `profile ${option}` });
  for await (const event of events) {
   if (event.kind === 'approval_request') {
    assert.equal(event.options.some(option => option.id === 'cancel'), false);
    await assert.rejects(adapter.approve(handle, event.request, 'cancel'), /option/);
    if (option === 'interrupt') await adapter.interrupt(handle);
    else await adapter.approve(handle, event.request, option);
   }
   if (event.kind === 'error') assert.fail(JSON.stringify(event));
   if (event.kind === 'turn_end' || event.kind === 'interrupted') break;
  }
 } finally { await adapter.dispose(handle); }
});
