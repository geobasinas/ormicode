import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn as spawnProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';
import { createSession, getSession, getTeam, unreadTeamMessages } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import { TestMcpCredentials } from './mcp-fixture.mjs';

async function eventually(check) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('timed out waiting for team state');
    await setTimeout(20);
  }
}
async function fixture(t, slow = false) {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-teams-'));
  const project = join(dir, 'project'); mkdirSync(project);
  const saved = Object.fromEntries(['ORMICODE_HOME', 'ORMICODE_FAKE_SCRIPT', 'ORMICODE_FAKE_DELAY_MS'].map(k => [k, process.env[k]]));
  process.env.ORMICODE_HOME = join(dir, 'home');
  process.env.ORMICODE_FAKE_SCRIPT = slow ? 'slow' : 'echo';
  process.env.ORMICODE_FAKE_DELAY_MS = '1500';
  execFileSync('git', ['init', '-q', project]);
  writeFileSync(join(project, 'hello.txt'), 'initial\n');
  execFileSync('git', ['add', 'hello.txt'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], { cwd: project });
  const credentials = new TestMcpCredentials();
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db'), mcpCredentials: credentials });
  const client = await connect(daemon.socketPath);
  t.after(async () => {
    client.close(); await daemon.close();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  });
  const req = (method, body) => client.request(method, body, 30_000, method.startsWith('team.') ? credentials.proof(body.actor) : undefined);
  const res = await req('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'test', effort: 'test', mode: 'acceptEdits', workspace: { kind: 'current' } });
  assert.equal(res.type, 'res', JSON.stringify(res));
  const parent = res.body.session;
  const spawn = async task => {
    const r = await req('team.spawn', { actor: parent, task });
    assert.equal(r.type, 'res', JSON.stringify(r));
    return r.body;
  };
  const idle = session => eventually(() => ['idle', 'done'].includes(getSession(daemon.db, session)?.state)
    && replay(daemon.db, session).some(e => e.kind === 'turn_end'));
  return { daemon, req, parent, spawn, idle, project, credentials, client };
}
const events = (db, s, kind) => replay(db, s).filter(e => e.kind === kind).map(e => JSON.parse(e.payload));

test('team spawn creates isolated children, inherits mode, limits children and checks depth', async t => {
  const { daemon, req, parent, spawn, idle, project, credentials } = await fixture(t);
  await req('session.prompt', { session: parent, text: 'PRIVATE PARENT TRANSCRIPT' }); await idle(parent);
  daemon.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.children', '1');
  const { team, session } = await spawn('implement a thing'); await idle(session);
  assert.equal(getTeam(daemon.db, team).parent, parent);
  const child = getSession(daemon.db, session);
  assert.equal(child.parent, parent); assert.equal(child.team, team);
  assert.ok(child.worktree); assert.notEqual(child.cwd, project); assert.equal(child.mode, 'acceptEdits');
  const prompt = events(daemon.db, session, 'prompt')[0].text;
  assert.match(prompt, /implement a thing/); assert.match(prompt, /team board/); assert.doesNotMatch(prompt, /PRIVATE PARENT/);
  const capped = await req('team.spawn', { actor: parent, task: 'too many' });
  assert.equal(capped.code, 'team.limit');
  assert.match(capped.message, /child limit/);
  assert.equal(events(daemon.db, parent, 'agent_spawned')[0].child, session);
  const ancestor = newId('s'), nested = newId('s');
  for (const [id, p] of [[ancestor, parent], [nested, ancestor]]) createSession(daemon.db, { id, parent: p, machine: 'm', project, vendor: 'fake', transport: 'cli', cwd: project });
  credentials.issue(nested);
  const deep = await req('team.spawn', { actor: nested, task: 'too deep' });
  assert.equal(deep.code, 'team.limit'); assert.match(deep.message, /depth/);
  const allowlist = await req('team.spawn', { actor: parent, task: 'restricted', toolAllowlist: ['Read'] });
  assert.equal(allowlist.code, 'agent.unsupported');
});

test('daemon enforces parent-only operations, child self-close and team membership', async t => {
  const { daemon, req, parent, spawn, idle } = await fixture(t);
  const a = await spawn('a'), b = await spawn('b'); await idle(a.session); await idle(b.session);
  for (const [method, extra] of [
    ['team.spawn', { task: 'no' }], ['team.tree', {}], ['team.status', {}], ['team.cancel', {}],
    ['team.reassign', { task: 'no' }], ['team.diff', {}], ['team.report', {}], ['team.close', {}],
  ]) {
    const r = await req(method, { actor: a.session, session: b.session, ...extra });
    assert.equal(r.code, 'team.forbidden', `${method}: ${JSON.stringify(r)}`);
  }
  assert.equal((await req('team.status', { actor: parent, session: newId('s') })).code, 'team.not_member');
  assert.equal((await req('team.message', { actor: a.session, to: newId('s'), text: 'no' })).code, 'team.not_member');
  assert.equal((await req('team.message', { actor: a.session, replyTo: newId('q'), text: 'no' })).code, 'team.invalid');
  assert.equal((await req('team.close', { actor: a.session, session: a.session })).body.closed, true);
  assert.equal(getSession(daemon.db, a.session).archived, 1);
  const roster = await req('team.tree', { actor: parent }); assert.equal(roster.body.children.length, 2);
  assert.equal((await req('team.close', { actor: parent, session: parent })).body.closed, true);
  assert.ok(getTeam(daemon.db, a.team).closed_at);
  assert.equal(getSession(daemon.db, b.session).archived, 1);
  assert.equal((await req('team.report', { actor: b.session, session: b.session })).code, 'mcp.unauthorized');
});

test('idle sibling messages use prompts, replies work and parent gets a quiet event', async t => {
  const { daemon, req, parent, spawn, idle } = await fixture(t);
  const a = await spawn('a'), b = await spawn('b'); await idle(a.session); await idle(b.session);
  const sent = await req('team.message', { actor: a.session, to: b.session, text: 'finding from a' });
  assert.equal(sent.type, 'res', JSON.stringify(sent));
  await eventually(() => events(daemon.db, b.session, 'text').some(e => e.text.includes('finding from a')));
  assert.deepEqual(unreadTeamMessages(daemon.db, b.session), []);
  const quiet = events(daemon.db, parent, 'team_message').at(-1);
  assert.equal(quiet.quiet, true); assert.equal(quiet.from, a.session); assert.equal(quiet.to, b.session);
  const reply = await req('team.message', { actor: b.session, replyTo: sent.body.id, text: 'thanks' });
  assert.equal(reply.type, 'res');
  await eventually(() => events(daemon.db, a.session, 'text').some(e => e.text.includes('thanks')));
  assert.deepEqual((await req('team.inbox', { actor: b.session })).body.messages, []);
});

test('busy sibling messages stay unread until the next prompt; urgent interrupts then delivers', async t => {
  const { daemon, req, parent, spawn, idle } = await fixture(t, true);
  const a = await spawn('a'), b = await spawn('b'); await idle(a.session); await idle(b.session);
  await req('session.prompt', { session: b.session, text: 'busy task' });
  await eventually(() => getSession(daemon.db, b.session).state === 'running');
  const before = events(daemon.db, b.session, 'prompt').length;
  await req('team.message', { actor: a.session, to: b.session, text: 'next step finding' });
  assert.equal(unreadTeamMessages(daemon.db, b.session).length, 1);
  assert.equal(events(daemon.db, b.session, 'prompt').length, before);
  await eventually(() => getSession(daemon.db, b.session).state === 'idle');
  assert.equal(unreadTeamMessages(daemon.db, b.session).length, 1);
  await req('session.prompt', { session: b.session, text: 'continue' });
  await eventually(() => events(daemon.db, b.session, 'text').some(e => e.text.includes('next step finding') && e.text.includes('continue')));
  await eventually(() => getSession(daemon.db, b.session).state === 'idle');
  await req('session.prompt', { session: b.session, text: 'interrupt me' });
  await eventually(() => getSession(daemon.db, b.session).state === 'running');
  const urgent = await req('team.message', { actor: a.session, to: b.session, text: 'stop, wrong branch', urgent: true });
  assert.equal(urgent.type, 'res', JSON.stringify(urgent));
  await eventually(() => events(daemon.db, b.session, 'text').some(e => e.text.includes('stop, wrong branch')));
  assert.ok(events(daemon.db, b.session, 'interrupted').length);
  const cancel = await req('team.cancel', { actor: parent, session: b.session });
  assert.equal(cancel.type, 'res', JSON.stringify(cancel)); assert.equal(cancel.body.interrupted, true);
});

test('board entries survive parent state changes; diff, status, report and reassign return data', async t => {
  const { daemon, req, parent, spawn, idle } = await fixture(t);
  const a = await spawn('report task'); await idle(a.session);
  assert.equal((await req('team.report', { actor: parent, session: a.session })).body.text.includes('report task'), true);
  assert.equal((await req('team.diff', { actor: parent, session: a.session })).body.patch, '');
  writeFileSync(join(getSession(daemon.db, a.session).cwd, 'hello.txt'), 'changed\n');
  const diff = await req('team.diff', { actor: parent, session: a.session });
  assert.match(diff.body.patch, /changed/); assert.equal(diff.body.files[0].path, 'hello.txt');
  const state = await req('team.status', { actor: parent, session: a.session });
  assert.equal(state.body.session, a.session); assert.equal(typeof state.body.lastActivity, 'number'); assert.equal(state.body.tokens, null);
  const empty = await req('team.board', { actor: a.session, action: 'read' }); assert.match(empty.body.board, /Current state/);
  const append = await req('team.board', { actor: a.session, action: 'append', text: 'child finding' }); assert.match(append.body.board, /child finding/);
  assert.equal((await req('team.board', { actor: a.session, action: 'setState', text: 'no' })).code, 'team.forbidden');
  const update = await req('team.board', { actor: parent, action: 'setState', text: 'current decision' });
  assert.match(update.body.board, /current decision/); assert.match(update.body.board, /child finding/);
  assert.equal((await req('team.board', { actor: parent, action: 'append' })).code, 'team.invalid');
  assert.equal(events(daemon.db, parent, 'board_entry').length, 2);
  const reassigned = await req('team.reassign', { actor: parent, session: a.session, task: 'new task' }); assert.equal(reassigned.body.accepted, true);
  await eventually(() => events(daemon.db, a.session, 'text').some(e => e.text === 'new task'));
});

test('concurrent child cap and active team cap use stored settings', async t => {
  const { daemon, req, parent, spawn, idle, credentials } = await fixture(t, true);
  daemon.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.concurrent', '1');
  const a = await spawn('busy');
  await eventually(() => getSession(daemon.db, a.session).state === 'running');
  const blocked = await req('team.spawn', { actor: parent, task: 'blocked' });
  assert.equal(blocked.code, 'team.limit'); assert.match(blocked.message, /concurrent/);
  await idle(a.session);
  const b = await spawn('next'); await idle(b.session);
  await req('session.prompt', { session: a.session, text: 'busy again' });
  await eventually(() => getSession(daemon.db, a.session).state === 'running');
  const prompt = await req('session.prompt', { session: b.session, text: 'over cap' });
  assert.equal(prompt.type, 'err'); assert.match(prompt.message, /team.limit/);
  const queued = await req('team.message', { actor: a.session, to: b.session, text: 'deliver when a releases its slot' });
  assert.equal(queued.type, 'res');
  assert.equal(unreadTeamMessages(daemon.db, b.session).length, 1);
  await eventually(() => events(daemon.db, b.session, 'text').some(e => e.text.includes('deliver when a releases its slot')));
  daemon.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.maxTeams', '1');
  const independent = newId('s');
  createSession(daemon.db, { id: independent, machine: 'm', project: getSession(daemon.db, parent).project, vendor: 'fake', transport: 'cli', cwd: '.' });
  credentials.issue(independent);
  const max = await req('team.spawn', { actor: independent, task: 'other team' });
  assert.equal(max.code, 'team.limit'); assert.match(max.message, /active team/);
});

test('daemon rejects missing, spoofed and expired MCP proofs and authenticates ownership claims', async t => {
  const { daemon, client, parent, spawn, idle, credentials, project } = await fixture(t);
  const proof = credentials.proof(parent);
  const raw = (method, body, auth) => client.request(method, body, 30_000, auth);
  const start = { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'test', effort: 'test', mode: 'default', workspace: { kind: 'current' }, parent };
  const started = await raw('session.start', start, proof);
  assert.equal(started.type, 'res', JSON.stringify(started)); assert.equal(getSession(daemon.db, started.body.session).parent, parent);
  const a = await spawn('child'); await idle(a.session);
  for (const auth of [undefined, { session: parent, token: '' }, { session: parent, token: 'f'.repeat(64) }, { session: parent, token: 4 }]) {
    const rejected = await raw('team.tree', { actor: parent }, auth);
    assert.equal(rejected.code, 'mcp.unauthorized'); assert.match(rejected.message, /MCP session proof/);
  }
  assert.equal((await raw('team.tree', { actor: parent }, credentials.proof(a.session))).code, 'mcp.forbidden');
  assert.equal((await raw('team.tree', { actor: a.session }, proof)).code, 'mcp.forbidden');
  assert.equal((await raw('team.tree', { actor: newId('s') })).code, 'mcp.unauthorized');
  assert.equal((await raw('team.tree', { actor: parent }, proof)).body.children.length, 1);
  assert.equal((await raw('session.start', start)).code, 'mcp.unauthorized');
  assert.equal((await raw('session.start', start, credentials.proof(a.session))).code, 'mcp.forbidden');
  assert.equal((await raw('session.handoff', { session: parent, to: { vendor: 'fake' }, mode: 'rehydrate', agentApproval: true })).code, 'mcp.unauthorized');
  assert.equal((await raw('session.handoff', { session: parent, to: { vendor: 'fake' }, mode: 'rehydrate', agentApproval: true }, credentials.proof(a.session))).code, 'mcp.forbidden');
  assert.equal((await raw('session.prompt', { session: parent, text: 'spoof' }, credentials.proof(a.session))).code, 'mcp.forbidden');
  assert.equal((await raw('session.subscribe', { session: parent }, credentials.proof(a.session))).code, 'mcp.forbidden');
  assert.equal((await raw('session.setNotes', { session: parent, title: 'spoof', body: '' }, credentials.proof(a.session))).code, 'mcp.forbidden');
  assert.equal((await raw('secret.list', {}, proof)).code, 'mcp.forbidden');
  const frames = []; client.onFrame = frame => frames.push(frame);
  assert.equal((await raw('session.subscribe', { session: parent }, proof)).type, 'res');
  assert.equal((await raw('session.prompt', { session: parent, text: `credential ${proof.token}` }, proof)).type, 'res');
  await idle(parent);
  assert.ok(!JSON.stringify(replay(daemon.db, parent)).includes(proof.token));
  assert.ok(!JSON.stringify(frames).includes(proof.token));
  daemon.workers.get(parent).proc.kill();
  await eventually(() => !credentials.verify(proof));
  assert.equal((await raw('team.tree', { actor: parent }, proof)).code, 'mcp.unauthorized');
  assert.equal((await raw('session.prompt', { session: parent, text: 'wake worker' })).type, 'res');
  assert.notEqual(credentials.proof(parent).token, proof.token);
  assert.equal((await raw('team.tree', { actor: parent }, credentials.proof(parent))).type, 'res');
  credentials.revoke(parent);
  assert.equal((await raw('team.tree', { actor: parent }, credentials.proof(parent))).code, 'mcp.unauthorized');
});

test('real stdio MCP server sends worker proof for team tools and existing ownership paths', async t => {
  const { daemon, parent, spawn, idle, credentials } = await fixture(t);
  const child = await spawn('child'); await idle(child.session);
  const proc = spawnProcess(process.execPath, [fileURLToPath(new URL('../src/mcp-serve.ts', import.meta.url))], {
    env: { ...process.env, ORMICODE_SOCKET: daemon.socketPath, ORMI_SESSION: parent, ORMI_MCP_TOKEN: credentials.proof(parent).token },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  t.after(() => proc.kill());
  const replies = new Map(); let buffer = '', id = 0;
  proc.stdout.on('data', chunk => {
    buffer += String(chunk);
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      replies.set(reply.id, reply);
    }
  });
  const call = async (name, args = {}) => {
    const request = ++id;
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: request, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    await eventually(() => replies.has(request));
    const reply = replies.get(request);
    assert.equal(reply.result.isError, undefined, JSON.stringify(reply));
    return reply.result.content[0].text;
  };
  const roster = JSON.parse(await call('team_roster', { actor: child.session }));
  assert.equal(roster.children[0].session, child.session);
  await call('ormi_message', { session: child.session, text: 'authenticated message' });
  await call('ormi_wait', { session: child.session, until: 'idle', timeoutMs: 10000 });
  assert.ok(events(daemon.db, child.session, 'prompt').some(event => event.text === 'authenticated message'));
  await call('team_wait', { session: child.session, timeoutMs: 10000 });
});
