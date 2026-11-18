import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';

const env = { ORMICODE_FAKE_SCRIPT: 'tool', ORMICODE_FAKE_DELAY_MS: '400' };
const until = async (fn, ms = 10_000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)); }
};

test('tool calls leave checkpoints; restore and fork use them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-cp-daemon-'));
  Object.assign(process.env, env, { ORMICODE_HOME: join(dir, 'home') });
  const project = join(dir, 'proj');
  execFileSync('git', ['init', '-q', '-b', 'main', project]);
  writeFileSync(join(project, 'a.txt'), 'one\n');
  execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'init', '--allow-empty']);
  execFileSync('git', ['-C', project, 'add', 'a.txt']);
  execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a']);
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  try {
    const start = await client.request('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
    const session = start.body.session;
    await until(async () => (await client.request('session.get', { session })).body.state === 'idle');
    await client.request('session.prompt', { session, text: 'edit' });
    await until(async () => (await client.request('checkpoint.list', { session })).body.checkpoints.length === 1);
    writeFileSync(join(project, 'a.txt'), 'two\n');
    writeFileSync(join(project, 'b.txt'), 'new\n');
    const list = await until(async () => { const r = await client.request('checkpoint.list', { session }); return r.body.checkpoints.length === 2 && r.body.checkpoints; });
    assert.deepEqual(list.map(c => c.tool), ['fake_tool', 'baseline']);
    const diff = await client.request('checkpoint.diff', { session, from: list[0].id });
    assert.match(diff.body.patch, /\+two/);
    await until(async () => (await client.request('session.get', { session })).body.state === 'idle');
    const conv = await client.request('checkpoint.restore', { session, id: list[1].id, mode: 'conversation' });
    assert.equal(conv.code, 'checkpoint.unimplemented');
    const res = await client.request('checkpoint.restore', { session, id: list[1].id, mode: 'files' });
    assert.equal(res.body.restored, true);
    assert.equal(readFileSync(join(project, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(existsSync(join(project, 'b.txt')), false);
    const fork = await client.request('checkpoint.fork', { session, id: list[0].id });
    assert.equal(fork.type, 'res', JSON.stringify(fork));
    assert.match(fork.body.branch, /^main-fork-[0-9a-f]{6}$/);
    assert.equal(readFileSync(join(fork.body.cwd, 'b.txt'), 'utf8'), 'new\n');
    assert.equal((await client.request('session.get', { session: fork.body.session })).body.parent, session);
  } finally {
    await daemon.close();
    for (const k of [...Object.keys(env), 'ORMICODE_HOME']) delete process.env[k];
  }
});
