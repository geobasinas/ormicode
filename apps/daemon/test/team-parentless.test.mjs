import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { newId } from '@ormicode/protocol';
import { getSession, listQueuedPrompts, unreadTeamMessages } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import { startDaemon, connect } from '../src/index.ts';
import { TestMcpCredentials } from './mcp-fixture.mjs';

async function eventually(check) {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('timed out waiting for team lifecycle');
    await setTimeout(20);
  }
}
const events = (db, session, kind) => replay(db, session).filter(e => e.kind === kind).map(e => JSON.parse(e.payload));
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-parentless-'));
  const project = join(dir, 'project'); mkdirSync(project);
  const previous = Object.fromEntries(['ORMICODE_HOME', 'ORMICODE_FAKE_SCRIPT', 'ORMICODE_FAKE_DELAY_MS'].map(key => [key, process.env[key]]));
  process.env.ORMICODE_HOME = join(dir, 'home'); process.env.ORMICODE_FAKE_SCRIPT = 'echo'; process.env.ORMICODE_FAKE_DELAY_MS = '60000';
  execFileSync('git', ['init', '-q', project]);
  writeFileSync(join(project, 'hello.txt'), 'initial\n');
  execFileSync('git', ['add', 'hello.txt'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], { cwd: project });
  const credentials = new TestMcpCredentials();
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db'), mcpCredentials: credentials });
  const client = await connect(daemon.socketPath);
  t.after(async () => {
    client.close(); await daemon.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  const req = (method, body) => client.request(method, body, 30_000, method.startsWith('team.') ? credentials.proof(body.actor) : undefined);
  const started = await req('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'test', effort: 'test', mode: 'default', workspace: { kind: 'current' } });
  assert.equal(started.type, 'res', JSON.stringify(started));
  const parent = started.body.session;
  await req('session.pause', { session: parent });
  const spawn = async (script = 'slow') => {
    process.env.ORMICODE_FAKE_SCRIPT = script;
    const child = await req('team.spawn', { actor: parent, task: 'echo safe' });
    assert.equal(child.type, 'res', JSON.stringify(child));
    await eventually(() => events(daemon.db, child.body.session, 'turn_start').length);
    return child.body.session;
  };
  return { daemon, req, parent, spawn };
}

test('real timer uses a short silence setting and journals one inbox nudge without stopping a child', async t => {
  const { daemon, req, parent, spawn } = await fixture(t);
  daemon.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.silenceMs', '80');
  const child = await spawn(), pid = daemon.workers.get(child).pid;
  await eventually(() => events(daemon.db, parent, 'team_message').some(e => e.nudge));
  const nudges = events(daemon.db, parent, 'team_message').filter(e => e.nudge);
  assert.equal(nudges.length, 1); assert.equal(nudges[0].from, child);
  assert.ok(unreadTeamMessages(daemon.db, parent).some(m => m.id === nudges[0].message));
  assert.equal(getSession(daemon.db, child).state, 'running'); assert.equal(daemon.workers.get(child).pid, pid);
  assert.equal((await req('team.cancel', { actor: parent, session: child })).type, 'res');
});

test('killing a parent keeps children running, returns approvals to the user and resume reattaches', async t => {
  const { daemon, req, parent, spawn } = await fixture(t);
  const child = await spawn(), approvalChild = await spawn('approval'), pid = daemon.workers.get(child).pid;
  await eventually(() => events(daemon.db, approvalChild, 'team_approval_request').length);
  daemon.workers.get(parent).proc.kill();
  await eventually(() => getSession(daemon.db, child).parentless && !daemon.workers.has(parent));
  assert.equal(getSession(daemon.db, child).state, 'running'); assert.equal(daemon.workers.get(child).pid, pid);
  assert.equal((await req('session.get', { session: child })).body.parentless, true);
  assert.equal((await req('session.list', {})).body.sessions.find(s => s.id === child).parentless, true);
  await eventually(() => events(daemon.db, approvalChild, 'approval_request').length);
  const approval = events(daemon.db, approvalChild, 'approval_request')[0];
  assert.equal((await req('session.decide', { session: approvalChild, request: approval.request, option: 'allow' })).type, 'res');
  await eventually(() => getSession(daemon.db, approvalChild).state === 'idle');
  await req('session.prompt', { session: approvalChild, text: 'echo still safe' });
  await eventually(() => events(daemon.db, approvalChild, 'approval_request').length === 2);
  assert.equal(events(daemon.db, approvalChild, 'team_approval_request').length, 1);
  assert.equal((await req('session.resume', { session: parent })).type, 'res');
  assert.equal(getSession(daemon.db, child).parentless, 0);
  assert.equal((await req('team.status', { actor: parent, session: child })).body.parentless, false);
  assert.equal((await req('team.tree', { actor: parent })).body.children.find(s => s.session === child).parentless, false);
  const pending = events(daemon.db, approvalChild, 'approval_request').at(-1);
  await req('session.decide', { session: approvalChild, request: pending.request, option: 'allow' });
  await eventually(() => getSession(daemon.db, approvalChild).state === 'idle');
  await req('session.prompt', { session: approvalChild, text: 'echo reattached' });
  await eventually(() => events(daemon.db, approvalChild, 'team_approval_request').length === 2);
});

test('archiving a parent routes even urgent parent messages to user questions, with durable queued replies', async t => {
  const { daemon, req, parent, spawn } = await fixture(t);
  const child = await spawn(), pid = daemon.workers.get(child).pid;
  assert.equal((await req('session.archive', { session: parent })).type, 'res');
  assert.equal(getSession(daemon.db, child).parentless, 1);
  const sent = await req('team.message', { actor: child, to: parent, text: 'Please review my finding', urgent: true });
  assert.equal(sent.type, 'res', JSON.stringify(sent));
  const question = events(daemon.db, child, 'question_request').at(-1);
  assert.equal(question.teamMessage, sent.body.id);
  assert.ok(events(daemon.db, child, 'team_message').find(e => e.toUser && e.message === sent.body.id));
  assert.equal(unreadTeamMessages(daemon.db, parent).length, 0);
  assert.equal(getSession(daemon.db, child).state, 'running'); assert.equal(daemon.workers.get(child).pid, pid);
  assert.equal((await req('session.get', { session: child })).body.state, 'awaiting_input');
  assert.equal((await req('session.digest', { since: 0 })).body.entries.find(e => e.session === child).wants.kind, 'question');
  const answer = { session: child, request: question.request, answers: { finding: 'Thanks, keep going' } };
  assert.equal((await req('session.answer', { ...answer, answers: {} })).code, 'team.invalid');
  assert.equal((await req('session.answer', answer)).type, 'res');
  assert.equal((await req('session.answer', answer)).code, 'session.already_decided');
  assert.ok(listQueuedPrompts(daemon.db, child).some(p => p.text.includes('Thanks, keep going')));
  assert.equal(getSession(daemon.db, child).state, 'running');
  assert.equal((await req('session.get', { session: child })).body.state, 'running');
  assert.equal(events(daemon.db, child, 'question_answer').at(-1).actor, 'cli');
});

test('parent failure is exposed in team tree/status and a new parent turn clears parentless', async t => {
  const { daemon, req, parent, spawn } = await fixture(t);
  await req('session.resume', { session: parent });
  const child = await spawn();
  await req('worker.state', { session: parent, state: 'failed', reason: 'test failure' });
  assert.equal(getSession(daemon.db, child).state, 'running');
  assert.equal((await req('team.tree', { actor: parent })).body.children.find(s => s.session === child).parentless, true);
  assert.equal((await req('team.status', { actor: parent, session: child })).body.parentless, true);
  assert.equal((await req('session.prompt', { session: parent, text: 'reattach' })).type, 'res');
  await eventually(() => getSession(daemon.db, child).parentless === 0);
  assert.deepEqual(events(daemon.db, child, 'team_parent_changed').map(e => e.parentless), [true, false]);
});
