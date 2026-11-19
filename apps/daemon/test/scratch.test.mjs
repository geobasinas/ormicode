import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';

test('scratch copy-out stays contained, reports conflicts, and requires overwrite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-scratch-copy-test-'));
  const home = join(dir, 'home');
  const project = join(dir, 'project');
  mkdirSync(project, { recursive: true });
  const previousHome = process.env.ORMICODE_HOME;
  process.env.ORMICODE_HOME = home;
  let daemon;
  let client;
  try {
    daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
    client = await connect(daemon.socketPath);
    const started = await client.request('session.start', {
      machine: newId('m'), project: 'scratch', vendor: 'fake', transport: 'cli',
      model: 'default', effort: 'default', mode: 'default', workspace: { kind: 'scratch' },
    });
    const session = started.body.session;
    const details = await client.request('session.get', { session });
    const scratch = details.body.cwd;
    mkdirSync(join(scratch, 'notes'), { recursive: true });
    writeFileSync(join(scratch, 'notes', 'brief.md'), 'from scratch');
    const counts = await client.request('session.get', { session });
    assert.equal(counts.body.scratchFiles, 1);

    const waitUntilIdle = async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const current = await client.request('session.get', { session });
        if (current.body.state === 'idle') return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('scratch session did not become idle');
    };
    await waitUntilIdle();

    const copied = await client.request('session.copyOut', { session, paths: ['notes'], project, dest: 'docs' });
    assert.equal(copied.type, 'res');
    assert.deepEqual(copied.body.copied, [{ from: 'notes', to: 'docs/notes' }]);
    assert.equal(readFileSync(join(project, 'docs', 'notes', 'brief.md'), 'utf8'), 'from scratch');

    const conflict = await client.request('session.copyOut', { session, paths: ['notes'], project, dest: 'docs' });
    assert.equal(conflict.code, 'copy_out.conflict');
    assert.equal(readFileSync(join(project, 'docs', 'notes', 'brief.md'), 'utf8'), 'from scratch');
    const overwritten = await client.request('session.copyOut', {
      session, paths: ['notes'], project, dest: 'docs', overwrite: true,
    });
    assert.equal(overwritten.type, 'res');

    const traversal = await client.request('session.copyOut', { session, paths: ['../outside'], project });
    assert.equal(traversal.code, 'copy_out.invalid_path');
    const regular = await client.request('session.start', {
      machine: newId('m'), project, vendor: 'fake', transport: 'cli',
      model: 'default', effort: 'default', mode: 'default', workspace: { kind: 'current' },
    });
    const notScratch = await client.request('session.copyOut', { session: regular.body.session, paths: ['notes'], project });
    assert.equal(notScratch.code, 'session.not_scratch');
    const outside = join(dir, 'outside.txt');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(scratch, 'outside-link'));
    const symlink = await client.request('session.copyOut', { session, paths: ['outside-link'], project });
    assert.equal(symlink.code, 'copy_out.invalid_path');
    assert.equal(existsSync(join(project, 'outside-link')), false);
  } finally {
    client?.close();
    await daemon?.close();
    if (previousHome === undefined) delete process.env.ORMICODE_HOME;
    else process.env.ORMICODE_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
