import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexCliAdapter } from '../src/index.ts';

for (const option of ['accept', 'decline']) test(`CLI file approval ${option} reaches the vendor response and gates its fixture write`, async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'codex-write-')); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
  const adapter = new CodexCliAdapter({ spawn: (_cmd, _args, opts) => spawn(process.execPath, [fixture], opts) });
  const handle = await adapter.start({ cwd });
  try {
    const events = adapter.events(handle);
    await adapter.prompt(handle, { text: option === 'accept' ? 'approve write' : 'decline write' });
    for await (const event of events) {
      if (event.kind === 'approval_request') {
        assert.equal(existsSync(join(cwd, 'approved.txt')), false);
        await assert.rejects(adapter.approve(handle, event.request, 'invalid'), /option/);
        await adapter.approve(handle, event.request, option);
      }
      if (event.kind === 'turn_end') break;
    }
    assert.equal(existsSync(join(cwd, 'approved.txt')), option === 'accept');
  } finally { await adapter.dispose(handle); }
});
