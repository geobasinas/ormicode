import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';

test('terminal.* opens a broker shell, streams term frames and replays on attach', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-term-'));
  Object.assign(process.env, { ORMICODE_HOME: join(dir, 'home'), ORMICODE_PTY_IDLE_MS: '500' });
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const read = (client, until) => new Promise((res, rej) => {
    let out = ''; const t = setTimeout(() => rej(new Error(`timeout: ${out}`)), 10_000);
    client.onFrame = f => { if (f.type !== 'term') return; if (f.body.kind === 'terminal_output') out += Buffer.from(f.body.data, 'base64').toString(); if (until(out, f)) { clearTimeout(t); res(out); } };
  });
  try {
    const a = await connect(daemon.socketPath);
    const got = read(a, out => out.includes('ready'));
    const open = await a.request('terminal.open', { cwd: dir, shell: '/bin/sh', args: ['-c', 'echo ready; read x; echo got-$x'] });
    assert.equal(open.type, 'res', JSON.stringify(open));
    await got;
    const done = read(a, (_o, f) => f.body.kind === 'terminal_exit');
    await a.request('terminal.write', { terminal: open.body.terminal, data: Buffer.from('ok\n').toString('base64') });
    assert.match(await done, /got-ok/);
    a.close();
    const b = await connect(daemon.socketPath);
    const replay = read(b, (_o, f) => f.body.kind === 'terminal_exit');
    await b.request('terminal.attach', { terminal: open.body.terminal, from: 0 });
    assert.match(await replay, /ready[\s\S]*got-ok/);
    assert.equal((await b.request('terminal.list', {})).body.terminals.length, 1);
    await b.request('terminal.close', { terminal: open.body.terminal });
    b.close();
  } finally {
    await daemon.close();
    delete process.env.ORMICODE_HOME; delete process.env.ORMICODE_PTY_IDLE_MS;
  }
});
