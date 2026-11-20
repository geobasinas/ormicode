import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { startDaemon, connect } from '../src/index.ts';
import { onceOptions, TeamApprovals } from '../src/team-approvals.ts';
import { TestMcpCredentials } from './mcp-fixture.mjs';
import { newId } from '@ormicode/protocol';
import { getSession } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';

async function eventually(check) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('timed out waiting for approval state');
    await setTimeout(20);
  }
}
const events = (db, session, kind) => replay(db, session).filter(e => e.kind === kind).map(e => JSON.parse(e.payload));
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-team-approval-'));
  const project = join(dir, 'project'); mkdirSync(project);
  const previous = { ORMICODE_HOME: process.env.ORMICODE_HOME, ORMICODE_FAKE_SCRIPT: process.env.ORMICODE_FAKE_SCRIPT };
  process.env.ORMICODE_HOME = join(dir, 'home'); process.env.ORMICODE_FAKE_SCRIPT = 'echo';
  execFileSync('git', ['init', '-q', project]);
  writeFileSync(join(project, 'hello.txt'), 'initial\n');
  execFileSync('git', ['add', 'hello.txt'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], { cwd: project });
  const credentials = new TestMcpCredentials();
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db'), mcpCredentials: credentials });
  const client = await connect(daemon.socketPath);
  t.after(async () => {
    client.close(); await daemon.close();
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  const req = (method, body) => client.request(method, body, 30_000, method.startsWith('team.') ? credentials.proof(body.actor) : undefined);
  const started = await req('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'test', effort: 'test', mode: 'default', workspace: { kind: 'current' } });
  assert.equal(started.type, 'res'); const parent = started.body.session;
  await req('session.pause', { session: parent });
  process.env.ORMICODE_FAKE_SCRIPT = 'approval';
  const spawn = async (task = 'echo safe') => {
    const response = await req('team.spawn', { actor: parent, task });
    assert.equal(response.type, 'res', JSON.stringify(response));
    const session = response.body.session;
    await eventually(() => events(daemon.db, session, 'team_approval_request').length || events(daemon.db, session, 'approval_request').length);
    const approval = [...events(daemon.db, session, 'team_approval_request'), ...events(daemon.db, session, 'approval_request')].at(-1);
    return { session, request: approval.request };
  };
  const approve = (child, option, actor = parent) => req('team.approve', { actor, ...child, option, reason: `reviewed ${option}` });
  return { dir, daemon, client, req, parent, spawn, approve, credentials };
}

test('safe approval options are offered verbatim, once-only, and fail closed for unknown scopes', () => {
  const options = [
    { id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' },
    { id: 'one', label: 'Allow once', kind: 'allow_once' }, { id: 'no', label: 'Reject', kind: 'reject_once' },
    { id: 'always', label: 'Always allow', kind: 'allow_always' }, { id: 'allow_session', label: 'Allow for session' },
    { id: 'allow', label: 'Always allow' }, { id: 'unknown', label: 'Yes', kind: 'unknown' },
  ];
  assert.deepEqual(onceOptions({ options: options.filter((_, index) => index !== 6) }), options.slice(0, 4));
  assert.deepEqual(onceOptions({ options }), []);
  assert.deepEqual(onceOptions({}), []);
  const approvals = new TeamApprovals(() => ({}), () => false);
  assert.equal(approvals.event('child', 'approval_request', { destructive: true })[0], 'approval_request');
});

for (const option of ['allow', 'deny']) test(`parent ${option} answers only a pending offered option and is journaled`, async t => {
  const { daemon, client, req, parent, spawn, approve } = await fixture(t);
  const child = await spawn();
  assert.equal(events(daemon.db, child.session, 'approval_request').length, 0);
  assert.equal(getSession(daemon.db, child.session).state, 'running');
  const digest = await req('session.digest', { since: 0 });
  assert.equal(digest.body.entries.find(e => e.session === child.session).wants, null);
  assert.notEqual(digest.body.entries.find(e => e.session === child.session).rank, 'waiting');
  const inbox = await req('team.inbox', { actor: parent });
  const item = JSON.parse(inbox.body.messages[0].body);
  assert.equal(item.kind, 'approval'); assert.equal(item.request, child.request); assert.equal(item.session, child.session);
  assert.deepEqual(item.options.map(o => o.id), ['allow', 'deny']);
  assert.equal((await req('team.status', { actor: parent, session: child.session })).body.state, 'awaiting_approval');
  assert.equal((await client.request('team.approve', { actor: parent, ...child, option, reason: 'spoof' })).code, 'mcp.unauthorized');
  assert.equal((await approve(child, option, child.session)).code, 'team.forbidden');
  assert.equal((await approve(child, 'always')).code, 'team.invalid');
  assert.equal((await approve(child, 'allow_session')).code, 'team.invalid');
  assert.equal((await req('session.decide', { ...child, option })).code, 'team.forbidden');
  assert.equal((await approve(child, option)).body.decided, true);
  assert.equal((await approve(child, option)).code, 'session.already_decided');
  await eventually(() => events(daemon.db, child.session, 'approval_decision').length);
  const decision = events(daemon.db, child.session, 'approval_decision')[0];
  assert.equal(decision.actor, parent); assert.equal(decision.parentDecided, true);
  assert.equal(decision.reason, `reviewed ${option}`); assert.equal(decision.option, option);
  await eventually(() => getSession(daemon.db, child.session).state === (option === 'allow' ? 'idle' : 'interrupted'));
});

test('destructive commands, including custom patterns, stay in the user queue', async t => {
  const { daemon, req, parent, spawn, approve, dir } = await fixture(t);
  for (const command of ['rm -rf disposable-test-path', 'custom-danger']) {
    if (command === 'custom-danger') writeFileSync(join(dir, 'home', 'destructive.json'), JSON.stringify({ version: 1, patterns: [{ kind: 'prefix', value: 'custom-danger' }] }));
    const child = await spawn(command);
    const approval = events(daemon.db, child.session, 'approval_request')[0];
    assert.equal(approval.destructive, true); assert.equal(getSession(daemon.db, child.session).state, 'awaiting_approval');
    const digest = await req('session.digest', { since: 0 });
    assert.equal(digest.body.entries.find(e => e.session === child.session).wants.kind, 'approval');
    assert.equal((await req('team.inbox', { actor: parent })).body.messages.length, 0);
    assert.equal((await approve(child, 'allow')).code, 'session.already_decided');
    assert.equal((await req('session.decide', { ...child, option: 'deny' })).body.decided, true);
    await eventually(() => getSession(daemon.db, child.session).state === 'interrupted');
  }
});

test('a parent worker exiting returns outstanding approvals to the user', async t => {
  const { daemon, req, parent, spawn, approve } = await fixture(t);
  const child = await spawn();
  daemon.workers.get(parent).proc.kill();
  await eventually(() => events(daemon.db, child.session, 'approval_request').length);
  assert.equal(events(daemon.db, child.session, 'approval_request')[0].fallbackReason, 'parent_unavailable');
  assert.equal(getSession(daemon.db, child.session).state, 'awaiting_approval');
  assert.equal((await approve(child, 'allow')).code, 'mcp.unauthorized');
  assert.equal((await req('session.decide', { ...child, option: 'deny' })).body.decided, true);
  await eventually(() => events(daemon.db, child.session, 'approval_decision').length);
  assert.equal(events(daemon.db, child.session, 'approval_decision')[0].actor, 'cli');
  assert.equal(events(daemon.db, child.session, 'approval_decision')[0].parentDecided, false);
});

test('a closed parent returns pending approvals and subsequent approvals fall back to the user', async t => {
  const { daemon, req, parent, spawn } = await fixture(t);
  const child = await spawn();
  assert.equal((await req('session.archive', { session: parent })).body.archived, true);
  await eventually(() => events(daemon.db, child.session, 'approval_request').length);
  assert.equal((await req('session.decide', { ...child, option: 'allow' })).body.decided, true);
  await eventually(() => getSession(daemon.db, child.session).state === 'idle');
  await req('session.prompt', { session: child.session, text: 'echo another safe command' });
  await eventually(() => events(daemon.db, child.session, 'approval_request').length === 2);
  assert.equal(events(daemon.db, child.session, 'team_approval_request').length, 1);
  const approval = events(daemon.db, child.session, 'approval_request').at(-1);
  assert.equal((await req('session.decide', { session: child.session, request: approval.request, option: 'deny' })).body.decided, true);
});
