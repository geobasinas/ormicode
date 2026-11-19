import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBroker, connectBroker, ensureBroker, Scrollback } from '../src/index.ts';

const sockIn = dir => (process.platform === 'win32' ? `\\\\.\\pipe\\ormi-pty-test-${Date.now()}` : join(dir, 'pty.sock'));
// Set up before the request: events can arrive in the same read as the reply.
const collect = (client, until, base = 0) => new Promise((res, rej) => {
  let out = Buffer.alloc(0); const timer = setTimeout(() => rej(new Error(`timeout; got ${out}`)), 10_000);
  client.onEvent = e => {
    if (e.ev === 'output') { assert.equal(e.offset, base + out.length); out = Buffer.concat([out, Buffer.from(e.data, 'base64')]); }
    if (until(out, e)) { clearTimeout(timer); res(out); }
  };
});

test('scrollback keeps the last lines by offset', () => {
  const sb = new Scrollback(2);
  for (const l of ['a\n', 'b\n', 'c\n']) sb.push(Buffer.from(l));
  assert.deepEqual([sb.start, sb.end, sb.since(0).data.toString(), sb.since(4).data.toString()], [2, 6, 'b\nc\n', 'c\n']);
});

test('a reconnecting reader replays the identical buffer (coloured output)', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pty-'));
  const socketPath = sockIn(dir);
  const broker = await startBroker({ socketPath, idleMs: 60_000 });
  try {
    const a = await connectBroker(socketPath);
    const firstP = collect(a, out => out.includes('red') && out.includes('\n'));
    const opened = await a.request('open', { cwd: dir, shell: '/bin/sh', args: ['-c', "printf '\\033[31mred\\033[0m\\n'; read x; echo got-$x"], device: 'd1' });
    const first = await firstP;
    a.close();
    const b = await connectBroker(socketPath);
    const replay = collect(b, out => out.length >= first.length);
    await b.request('attach', { terminal: opened.terminal, from: 0 });
    const normalizeNewlines = output => output.toString('utf8').replace(/\r\n/g, '\n');
    assert.equal(normalizeNewlines(await replay), normalizeNewlines(first));
    assert.match(first.toString(), /\x1b\[31mred/);
    const done = collect(b, (_out, e) => e.ev === 'exit', first.length);
    await b.request('write', { terminal: opened.terminal, data: Buffer.from('yes\n').toString('base64') });
    assert.match((await done).toString(), /got-yes/);
    const list = await b.request('list');
    assert.equal(list.terminals[0].exited, true);
    b.close();
  } finally { await broker.close(); }
});

test('per-device limit, kill_device, and idle exit', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pty-'));
  const socketPath = sockIn(dir);
  let exited = false;
  await startBroker({ socketPath, idleMs: 200, maxPerDevice: 1, onExit: () => { exited = true; } });
  const c = await connectBroker(socketPath);
  assert.ok((await c.request('open', { cwd: dir, shell: '/bin/sh', device: 'd1', attach: false })).terminal);
  assert.equal((await c.request('open', { cwd: dir, shell: '/bin/sh', device: 'd1' })).error.code, 'terminal.limit');
  assert.equal((await c.request('kill_device', { device: 'd1' })).killed.length, 1);
  c.close();
  for (let i = 0; i < 40 && !exited; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(exited, true);
});

test('throttles burst output once, then resumes after the bucket refills', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pty-rate-'));
  const socketPath = sockIn(dir);
  const previousRate = process.env.ORMICODE_PTY_RATE;
  process.env.ORMICODE_PTY_RATE = '50000';
  const broker = await startBroker({ socketPath, idleMs: 60_000 });
  const c = await connectBroker(socketPath);
  try {
    const started = Date.now();
    const output = collect(c, out => out.includes('normal'));
    await c.request('open', { cwd: dir, shell: '/bin/sh', args: ['-c', "head -c 2000000 /dev/zero | tr '\\000' a; sleep 1.2; printf normal"] });
    const got = await output;
    const text = got.toString();
    assert.equal((text.match(/output over 1 MB\/s, dropping until it slows down/g) ?? []).length, 1);
    assert.ok(got.length < 50_000 + 50_000 * (Date.now() - started) / 1000 + 100);
    assert.ok(text.includes('normal'));
  } finally {
    c.close(); await broker.close();
    if (previousRate === undefined) delete process.env.ORMICODE_PTY_RATE; else process.env.ORMICODE_PTY_RATE = previousRate;
  }
});

test('ensureBroker starts a detached broker that outlives the client', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-pty-'));
  const socketPath = sockIn(dir);
  const c = await ensureBroker(socketPath, { ...process.env, ORMICODE_PTY_IDLE_MS: '300' });
  const t = (await c.request('open', { cwd: dir, shell: '/bin/sh', attach: false })).terminal;
  c.close();
  const again = await connectBroker(socketPath);
  assert.equal((await again.request('list')).terminals[0].terminal, t);
  await again.request('close', { terminal: t });
  again.close();
  for (let i = 0; i < 60 && existsSync(socketPath); i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(existsSync(socketPath), false);
});
