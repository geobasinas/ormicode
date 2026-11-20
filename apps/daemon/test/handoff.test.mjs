import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';
import { getSession, createSession } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { handoffBrief } from '../src/handoff.ts';
import { fileURLToPath } from 'node:url';
import { TestMcpCredentials } from './mcp-fixture.mjs';

const boot = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-handoff-test-'));
  const credentials = new TestMcpCredentials();
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db'), mcpCredentials: credentials });
  const client = await connect(daemon.socketPath);
  return { dir, daemon, client, credentials };
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
  const r = await client.request('session.handoff', { session: s1, to: { vendor: 'fake' }, mode: 'rehydrate', reason: 'testing', confirmed: true });
  assert.equal(r.type, 'res');
  const child = r.body.session;
  assert.notEqual(child, s1);
  assert.equal(getSession(daemon.db, child)?.parent, s1);
  assert.equal(getSession(daemon.db, s1)?.handed_off, 1);
  assert.match(r.body.brief, /^Goal:/);
  await daemon.close();
});

test('in_place handoff keeps the same session; guards cap the chain and block A→B→A', async () => {
  const { daemon, client } = await boot();
  const s1 = (await startFake(client)).body.session;
  const same = await client.request('session.handoff', { session: s1, to: { model: 'bigger' }, mode: 'in_place' });
  assert.equal(same.body.session, s1);
  // A(fake) -> B(other-vendor would fail transport check; use fake chain then bounce)
  const s2 = (await client.request('session.handoff', { session: s1, to: { vendor: 'fake' }, mode: 'rehydrate', confirmed: true })).body.session;
  const s3 = (await client.request('session.handoff', { session: s2, to: { vendor: 'fake' }, mode: 'rehydrate', confirmed: true })).body.session;
  const s4 = (await client.request('session.handoff', { session: s3, to: { vendor: 'fake' }, mode: 'rehydrate', confirmed: true })).body.session;
  assert.ok(s4.startsWith('s_'));
  const s5r = await client.request('session.handoff', { session: s4, to: { vendor: 'fake' }, mode: 'rehydrate' });
  assert.equal(s5r.type, 'err'); // depth 3 reached
  assert.equal(s5r.code, 'handoff.limit');
  await daemon.close();
});

test('handoff brief and estimate report context, changed files and unknown-price confirmation', async () => {
  const { daemon, client } = await boot();
  const session = (await startFake(client)).body.session;
  const brief = await client.request('session.handoffBrief', { session });
  assert.equal(brief.type, 'res');
  assert.match(brief.body.brief, /^Goal:/);
  assert.match(brief.body.brief, /^Next step: Continue from the last prompt\.$/m);
  assert.doesNotMatch(brief.body.brief, /None recorded|^Done so far:|^Files changed:|^Decisions:|^Open questions:|^Commands run:|^Current diff:/m);
  const estimate = await client.request('session.handoffEstimate', {
    session, to: { model: 'unknown-model' }, mode: 'rehydrate',
  });
  assert.equal(estimate.type, 'res');
  assert.equal(estimate.body.usd, null);
  assert.equal(estimate.body.confirmRequired, true);
  const inPlace = await client.request('session.handoffEstimate', {
    session, to: {}, mode: 'in_place',
  });
  assert.equal(inPlace.body.usd, 0);
  assert.equal(inPlace.body.confirmRequired, false);
  await daemon.close();
});

test('handoff brief uses task headings, summarizes work and excludes lifecycle internals', async () => {
  const { daemon, client } = await boot();
  const session = (await startFake(client)).body.session;
  const add = (kind, fields = {}) => append(daemon.db, session, { kind, payload: { kind, ...fields } });
  add('prompt', { text: 'Add a timeout to the API client.' });
  add('turn_start');
  add('text', { text: 'I kept the existing retry policy and added a bounded timeout.' });
  add('file_edit', { path: 'src/client.ts', size: 12, checkpoint: null });
  add('tool_call', { callId: 'call_test', name: 'Bash', input: { command: 'pnpm test' } });
  add('tool_result', { callId: 'call_test', status: 'completed', output: 'Tests passed: 12' });
  add('question_request', { request: 'req_question', questions: [{ question: 'Should the timeout be configurable?' }] });
  add('usage', { input: 1200, output: 340 });
  add('state', { state: 'running', reason: 'agent working' });
  const uptoSeq = replay(daemon.db, session).at(-1).seq;
  add('text', { text: 'This later update must not appear in the bounded recap.' });

  const brief = handoffBrief(daemon.db, session, 12, uptoSeq);
  for (const heading of ['Goal:', 'Done so far:', 'Files changed:', 'Open questions:', 'Commands run:', 'Current diff:', 'Next step:'])
    assert.ok(brief.includes(heading), `missing ${heading}`);
  assert.match(brief, /Goal: Add a timeout to the API client\./);
  assert.match(brief, /src\/client\.ts — edited/);
  assert.match(brief, /pnpm test → completed: Tests passed: 12/);
  assert.match(brief, /Should the timeout be configurable\?/);
  assert.doesNotMatch(brief, new RegExp(session));
  assert.doesNotMatch(brief, /turn_start|usage|state running|native fake-native|tmp\/ormi/);
  assert.doesNotMatch(brief, /This later update/);
  assert.ok(brief.length <= 8000);
  await daemon.close();
});

test('a task cannot bounce back to the vendor it just left', async () => {
  const { daemon, client } = await boot();
  // Seed a session row on a different vendor; the hub only knows 'fake'
  // transports, so hand it to fake, then try to hand the child back.
  const other = newId('s');
  createSession(daemon.db, { id: other, machine: newId('m'), project: otherProjectDir, vendor: 'other', transport: 'acp', cwd: otherProjectDir });
  const s2 = (await client.request('session.handoff', { session: other, to: { vendor: 'fake', transport: 'cli' }, mode: 'rehydrate', confirmed: true })).body.session;
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
  const third = await client.request('session.handoff', { session: s1, to: { vendor: 'fake' }, mode: 'rehydrate', confirmed: true });
  assert.equal(third.type, 'res');
  await daemon.close();
});

test('unknown-price handoffs require user confirmation and agent approval', async () => {
  const { daemon, client, credentials } = await boot();
  const session = (await startFake(client)).body.session;
  const gated = await client.request('session.handoff', { session, to: { vendor: 'fake' }, mode: 'rehydrate' });
  assert.equal(gated.type, 'err');
  assert.equal(gated.code, 'handoff.confirm_required');
  assert.match(gated.message, /confirmRequired/);
  const pending = client.request('session.handoff', {
    session, to: { vendor: 'fake' }, mode: 'rehydrate', reason: 'needs another agent', agentApproval: true,
  }, 30_000, credentials.proof(session));
  const deadline = Date.now() + 5000;
  let request;
  while (!request && Date.now() < deadline) {
    request = replay(daemon.db, session).find(event => event.kind === 'approval_request');
    if (!request) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(request);
  assert.equal(JSON.parse(request.payload).approvalKind, 'handoff');
  const decision = await client.request('session.decide', { session, request: JSON.parse(request.payload).request, option: 'deny' });
  assert.equal(decision.type, 'res');
  const declined = await pending;
  assert.equal(declined.type, 'err');
  assert.equal(declined.code, 'handoff.declined');
  await daemon.close();
});

test('ordinary user-routed handoffs expire when aborted and cannot be approved later', async t => {
  const { daemon, client, credentials } = await boot();
  t.after(async () => { client.close(); await daemon.close(); });
  const session = (await startFake(client)).body.session;
  const pending = client.request('session.handoff', { session, to: { vendor: 'fake' }, mode: 'rehydrate', agentApproval: true }, 30_000, credentials.proof(session));
  const deadline = Date.now() + 5000;
  let request;
  while (!request && Date.now() < deadline) {
    const event = replay(daemon.db, session).find(e => e.kind === 'approval_request');
    if (event) request = JSON.parse(event.payload).request;
    else await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(request);
  const aborted = await client.request('session.abort', { session });
  assert.equal(aborted.type, 'res', JSON.stringify(aborted));
  assert.equal((await pending).code, 'handoff.declined');
  assert.equal(replay(daemon.db, session).filter(e => e.kind === 'interaction_expired').length, 1);
  assert.equal((await client.request('session.decide', { session, request, option: 'approve' })).type, 'err');
  assert.equal(daemon.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE parent = ?').get(session).n, 0);
});

test('rehydrate rolls back when a fake child never becomes ready', async () => {
  const previousReady = process.env.ORMICODE_FAKE_READY;
  const previousTimeout = process.env.ORMICODE_HANDOFF_READY_MS;
  process.env.ORMICODE_FAKE_READY = 'ready';
  const { daemon, client } = await boot();
  try {
    const session = (await startFake(client)).body.session;
    const deadline = Date.now() + 5000;
    while (getSession(daemon.db, session)?.state !== 'idle' && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(getSession(daemon.db, session)?.state, 'idle');
    process.env.ORMICODE_FAKE_READY = 'never';
    process.env.ORMICODE_HANDOFF_READY_MS = '100';
    const result = await client.request('session.handoff', {
      session, to: { vendor: 'fake' }, mode: 'rehydrate', confirmed: true,
    });
    assert.equal(result.type, 'err');
    assert.equal(result.code, 'handoff.failed', result.message ?? JSON.stringify(result));
    assert.ok(getSession(daemon.db, session));
    assert.equal(getSession(daemon.db, session).state, 'idle');
    assert.equal(daemon.db.prepare('SELECT session FROM leases WHERE session = ?').get(session)?.session, session);
    assert.ok(replay(daemon.db, session).some(event => event.kind === 'handoff_failed'));
    assert.equal(daemon.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE parent = ?').get(session).n, 0);
  } finally {
    await daemon.close();
    if (previousReady === undefined) delete process.env.ORMICODE_FAKE_READY;
    else process.env.ORMICODE_FAKE_READY = previousReady;
    if (previousTimeout === undefined) delete process.env.ORMICODE_HANDOFF_READY_MS;
    else process.env.ORMICODE_HANDOFF_READY_MS = previousTimeout;
  }
});

test('the ormi MCP server answers initialize, tools/list and ormi_notes over stdio', async () => {
  const { daemon, client, credentials } = await boot();
  const session = (await startFake(client)).body.session;
  const serve = fileURLToPath(new URL('../src/mcp-serve.ts', import.meta.url));
  const proc = spawn(process.execPath, [serve], {
    env: { ...process.env, ORMICODE_SOCKET: daemon.socketPath, ORMI_SESSION: session, ORMI_MCP_TOKEN: credentials.proof(session).token },
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
