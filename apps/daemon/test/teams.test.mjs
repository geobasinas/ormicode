import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';
import { createSession, getSession, getTeam, unreadTeamMessages } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';

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
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  t.after(async () => {
    client.close(); await daemon.close();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  const req = (method, body) => client.request(method, body);
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
  return { daemon, req, parent, spawn, idle, project };
}
const events = (db, s, kind) => replay(db, s).filter(e => e.kind === kind).map(e => JSON.parse(e.payload));

test('team spawn creates isolated children, inherits mode, limits children and checks depth', async t => {
  const { daemon, req, parent, spawn, idle, project } = await fixture(t);
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
  assert.equal((await req('team.report', { actor: b.session, session: b.session })).code, 'team.closed');
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
  const cancel = await req('team.cancel', { actor: parent, session: b.session }); assert.equal(cancel.body.interrupted, true);
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
  const { daemon, req, parent, spawn, idle } = await fixture(t, true);
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
  const max = await req('team.spawn', { actor: independent, task: 'other team' });
  assert.equal(max.code, 'team.limit'); assert.match(max.message, /active team/);
});
