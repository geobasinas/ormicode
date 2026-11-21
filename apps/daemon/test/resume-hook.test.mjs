import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, startDaemon } from '../src/index.ts';
import { newId } from '@ormicode/protocol';

test('a second worker spawn runs and journals the resume hook after a turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-resume-worker-'));
  const project = join(dir, 'project');
  mkdirSync(join(project, '.ormi'), { recursive: true });
  const marker = join(project, 'resume.env');
  writeFileSync(join(project, '.ormi', 'resume'), `printf '%s|%s|%s|%s|%s\\n' "$PORT" "$ORMI_SESSION" "$ORMI_WORKTREE" "$ORMI_PROJECT_ROOT" "$ORMI_BRANCH" > "${marker}"`);
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  const seen = [];
  const journal = [];
  let session;
  client.onFrame = frame => {
    if (frame.type !== 'evt') return;
    journal.push(frame);
    if (frame.body?.kind === 'workspace_step' && frame.body?.step === 'resume') seen.push(frame);
  };
  try {
    const started = await client.request('session.start', {
      machine: newId('m'), project, vendor: 'fake', transport: 'cli',
      model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' },
    });
    assert.equal(started.type, 'res', JSON.stringify(started));
    session = started.body.session;
    await client.request('session.subscribe', { session });
    await client.request('session.prompt', { session, text: 'first turn' });
    const firstDeadline = Date.now() + 10_000;
    while (Date.now() < firstDeadline && !journal.some(frame => frame.session === session && frame.body?.kind === 'turn_end'))
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(journal.some(frame => frame.session === session && frame.body?.kind === 'turn_end'));
    const worker = daemon.workers.get(session);
    assert.ok(worker);
    worker.proc.kill('SIGKILL');
    const exitDeadline = Date.now() + 5_000;
    while (Date.now() < exitDeadline && daemon.workers.has(session)) await new Promise(resolve => setTimeout(resolve, 20));
    await client.request('session.prompt', { session, text: 'second turn' });
    const hookDeadline = Date.now() + 5_000;
    while (Date.now() < hookDeadline && seen.length === 0) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].body.status, 'ok');
    const values = readFileSync(marker, 'utf8').trim().split('|');
    assert.equal(values[0], String((await client.request('session.get', { session })).body.ports.base));
    assert.equal(values[1], session);
    assert.equal(values[2], project);
    assert.equal(values[3], project);
  } finally {
    if (session) await client.request('session.delete', { session }).catch(() => undefined);
    await daemon.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});
