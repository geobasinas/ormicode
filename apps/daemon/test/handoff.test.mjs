import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';
import { getSession, createSession } from '@ormicode/session-store';
import { fileURLToPath } from 'node:url';

const boot = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-handoff-test-'));
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  return { dir, daemon, client };
};
const projectDir = mkdtempSync(join(tmpdir(), 'ormi-handoff-project-'));
const otherProjectDir = mkdtempSync(join(tmpdir(), 'ormi-handoff-other-project-'));
test.after(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(otherProjectDir, { recursive: true, force: true });
});
const startFake = (client, project = projectDir) =>
  client.request('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });

test('rehydrate handoff links parent, marks old session handed off, brief reaches the child', async () => {
  const { daemon, client } = await boot();
  const s1 = (await startFake(client)).body.session;
  const r = await client.request('session.handoff', { session: s1, to: { vendor: 'fake' }, mode: 'rehydrate', reason: 'testing' });
  assert.equal(r.type, 'res');
  const child = r.body.session;
  assert.notEqual(child, s1);
  assert.equal(getSession(daemon.db, child)?.parent, s1);
  assert.equal(getSession(daemon.db, s1)?.handed_off, 1);
  assert.ok(r.body.brief.includes(s1));
  await daemon.close();
});

test('in_place handoff keeps the same session; guards cap the chain and block A→B→A', async () => {
  const { daemon, client } = await boot();
  const s1 = (await startFake(client)).body.session;
  const same = await client.request('session.handoff', { session: s1, to: { model: 'bigger' }, mode: 'in_place' });
  assert.equal(same.body.session, s1);
  // A(fake) -> B(other-vendor would fail transport check; use fake chain then bounce)
  const s2 = (await client.request('session.handoff', { session: s1, to: { vendor: 'fake' }, mode: 'rehydrate' })).body.session;
  const s3 = (await client.request('session.handoff', { session: s2, to: { vendor: 'fake' }, mode: 'rehydrate' })).body.session;
  const s4 = (await client.request('session.handoff', { session: s3, to: { vendor: 'fake' }, mode: 'rehydrate' })).body.session;
  assert.ok(s4.startsWith('s_'));
  const s5r = await client.request('session.handoff', { session: s4, to: { vendor: 'fake' }, mode: 'rehydrate' });
  assert.equal(s5r.type, 'err'); // depth 3 reached
  assert.equal(s5r.code, 'handoff.limit');
  await daemon.close();
});

test('a task cannot bounce back to the vendor it just left', async () => {
  const { daemon, client } = await boot();
  // Seed a session row on a different vendor; the hub only knows 'fake'
  // transports, so hand it to fake, then try to hand the child back.
  const other = newId('s');
  createSession(daemon.db, { id: other, machine: newId('m'), project: otherProjectDir, vendor: 'other', transport: 'acp', cwd: otherProjectDir });
  const s2 = (await client.request('session.handoff', { session: other, to: { vendor: 'fake', transport: 'cli' }, mode: 'rehydrate' })).body.session;
  const bounce = await client.request('session.handoff', { session: s2, to: { vendor: 'other' }, mode: 'rehydrate' });
  assert.equal(bounce.type, 'err');
  assert.equal(bounce.code, 'handoff.bounce');
  await daemon.close();
});

test('at most one handoff per turn — a running session gets exactly one', async () => {
  const { daemon, client } = await boot();
  process.env.ORMICODE_FAKE_SCRIPT = 'slow';
  const s1 = (await startFake(client)).body.session;
  delete process.env.ORMICODE_FAKE_SCRIPT;
  await client.request('session.prompt', { session: s1, text: 'hold' });
  const t0 = Date.now();
  while (getSession(daemon.db, s1)?.state !== 'running' && Date.now() - t0 < 10_000)
    await new Promise(r => setTimeout(r, 25));
  const first = await client.request('session.handoff', { session: s1, to: { effort: 'deeper' }, mode: 'in_place' });
  assert.equal(first.type, 'res');
  const second = await client.request('session.handoff', { session: s1, to: { model: 'other' }, mode: 'in_place' });
  assert.equal(second.type, 'err');
  assert.equal(second.code, 'handoff.limit');
  // The turn is over: not mid-turn any more, so a new handoff is allowed.
  await client.request('session.abort', { session: s1 });
  const t1 = Date.now();
  while (getSession(daemon.db, s1)?.state === 'running' && Date.now() - t1 < 10_000)
    await new Promise(r => setTimeout(r, 25));
  const third = await client.request('session.handoff', { session: s1, to: { vendor: 'fake' }, mode: 'rehydrate' });
  assert.equal(third.type, 'res');
  await daemon.close();
});

test('the ormi MCP server answers initialize, tools/list and ormi_notes over stdio', async () => {
  const { daemon, client } = await boot();
  const session = (await startFake(client)).body.session;
  const serve = fileURLToPath(new URL('../src/mcp-serve.ts', import.meta.url));
  const proc = spawn(process.execPath, [serve], {
    env: { ...process.env, ORMICODE_SOCKET: daemon.socketPath, ORMI_SESSION: session },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  try {
    const rpc = (msg) => { proc.stdin.write(JSON.stringify(msg) + '\n'); };
    const lines = [];
    proc.stdout.on('data', d => { for (const l of String(d).split('\n')) if (l.trim()) lines.push(JSON.parse(l)); });
    const next = async (pred, ms = 10_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const hit = lines.find(pred);
        if (hit) return hit;
        await new Promise(r => setTimeout(r, 25));
      }
      throw new Error('mcp reply timeout');
    };
    rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    const init = await next(m => m.id === 1);
    assert.equal(init.result.serverInfo.name, 'ormi');
    rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = await next(m => m.id === 2);
    const names = tools.result.tools.map(t => t.name);
    for (const t of ['ormi_sessions', 'ormi_start', 'ormi_message', 'ormi_wait', 'ormi_handoff', 'ormi_notes']) assert.ok(names.includes(t), t);
    rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ormi_notes', arguments: { title: 't1', body: 'hello' } } });
    const wrote = await next(m => m.id === 3);
    assert.ok(JSON.parse(wrote.result.content[0].text).id);
    rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ormi_notes', arguments: {} } });
    const read = await next(m => m.id === 4);
    assert.equal(JSON.parse(read.result.content[0].text).notes[0].body, 'hello');
    // Message to a foreign session is refused.
    const other = (await startFake(client, otherProjectDir)).body.session;
    rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'ormi_message', arguments: { session: other, text: 'hi' } } });
    const refused = await next(m => m.id === 5);
    assert.equal(refused.result.isError, true);
  } finally { proc.kill(); await daemon.close(); }
});
