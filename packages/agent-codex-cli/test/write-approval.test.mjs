import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexCliAdapter } from '../src/index.ts';

for (const option of ['accept', 'decline']) test(`CLI file approval ${option} reaches the vendor response and gates its fixture write`, async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'codex-write-')); t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}));
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

test('CLI default sandbox is read-only so a workspace write waits for approval; explicit workspace-write does not ask', async t => {
  const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
  for (const mode of [undefined, 'workspace-write']) {
    const cwd = mkdtempSync(join(tmpdir(), 'codex-write-')); t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}));
    let params;
    const adapter = new CodexCliAdapter({ spawn: (_cmd, _args, opts) => {
      const child = spawn(process.execPath, [fixture], opts);
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (line, ...rest) => { const frame = JSON.parse(line); if (frame.method === 'thread/start') params = frame.params; return write(line, ...rest); };
      return child;
    } });
    const handle = await adapter.start({ cwd, ...(mode ? { mode } : {}) });
    try {
      assert.equal(params.sandbox, mode ?? 'read-only');
      assert.equal(params.approvalPolicy, 'on-request');
      const kinds = [];
      await adapter.prompt(handle, { text: 'approve write' });
      for await (const event of adapter.events(handle)) {
        kinds.push(event.kind);
        if (event.kind === 'approval_request') {
          assert.equal(existsSync(join(cwd, 'approved.txt')), false);
          await adapter.approve(handle, event.request, 'accept');
        }
        if (event.kind === 'turn_end') break;
      }
      assert.equal(kinds.includes('approval_request'), mode === undefined);
      assert.equal(existsSync(join(cwd, 'approved.txt')), true);
    } finally { await adapter.dispose(handle); }
  }
});
