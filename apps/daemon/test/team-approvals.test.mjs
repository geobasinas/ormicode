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
import { addQueuedPrompt, getSession, listQueuedPrompts, unreadTeamMessages } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import { needsAttention } from '../../../packages/client-ui/src/features/session/attention.ts';

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

for (const reason of [undefined, '', 'major security design decision']) test(`parent escalation returns the original approval to the user (${JSON.stringify(reason)})`, async t => {
  const { daemon, req, parent, spawn, approve } = await fixture(t);
  const child = await spawn();
  const original = events(daemon.db, child.session, 'team_approval_request')[0];
  const body = { actor: parent, ...child, ...(reason !== undefined ? { reason } : {}) };
  assert.equal((await req('team.escalate', body)).body.escalated, true);
  const approval = events(daemon.db, child.session, 'approval_request')[0];
  assert.equal(approval.request, original.request);
  assert.deepEqual(approval.options, original.options);
  assert.equal(approval.userOnly, true);
  assert.equal(approval.escalatedBy, parent);
  assert.equal(approval.escalationReason, reason);
  assert.equal(getSession(daemon.db, child.session).state, 'awaiting_approval');
  assert.deepEqual((await req('session.get', { session: parent })).body.teamApprovals, []);
  const digest = await req('session.digest', { since: 0 });
  assert.equal(digest.body.entries.find(e => e.session === child.session).wants.kind, 'approval');
  assert.equal((await approve(child, 'allow')).code, 'session.already_decided');
  assert.equal((await req('team.escalate', body)).code, 'session.already_decided');
  assert.equal((await req('session.decide', { ...child, option: 'allow' })).body.decided, true);
  await eventually(() => getSession(daemon.db, child.session).state === 'idle');
  const decision = events(daemon.db, child.session, 'approval_decision')[0];
  assert.equal(decision.actor, 'cli');
  assert.equal(decision.parentDecided, false);
});

test('one user-routed approval stays in Needs You while another request remains delegated', async t => {
  const { daemon, client, req, parent, spawn, credentials } = await fixture(t);
  const child = await spawn();
  const pending = client.request('session.handoff', { session: child.session, to: { vendor: 'fake', model: 'unknown-price' }, mode: 'rehydrate', agentApproval: true }, 30_000, credentials.proof(child.session));
  await eventually(() => events(daemon.db, child.session, 'team_approval_request').length === 2);
  const summary = async () => (await req('session.list', {})).body.sessions.find(s => s.id === child.session);
  assert.equal((await summary()).delegatedApproval, true);
  await req('team.escalate', { actor: parent, ...child, reason: 'security-sensitive command' });
  const mixed = await summary();
  assert.equal(mixed.delegatedApproval, false);
  assert.equal(needsAttention(mixed), true);
  const digest = (await req('session.digest', { since: 0 })).body.entries.find(e => e.session === child.session);
  assert.equal(digest.wants.kind, 'approval');
  assert.equal(needsAttention(mixed, digest), true);
  assert.equal((await req('session.get', { session: parent })).body.teamApprovals.length, 1);
  await req('session.decide', { ...child, option: 'allow' });
  await eventually(() => getSession(daemon.db, child.session).state === 'idle');
  const delegated = await summary();
  assert.equal(delegated.delegatedApproval, true);
  assert.equal(needsAttention(delegated), false);
  const handoff = events(daemon.db, child.session, 'team_approval_request').find(e => e.approvalKind === 'handoff');
  await req('team.approve', { actor: parent, session: child.session, request: handoff.request, option: 'deny', reason: 'cleanup' });
  assert.equal((await pending).code, 'handoff.declined');
});

test('escalation rejects missing proof, forged actors, non-parents and undelegated requests', async t => {
  const { daemon, client, req, parent, spawn, approve, credentials } = await fixture(t);
  const child = await spawn();
  assert.equal((await client.request('team.escalate', { actor: parent, ...child })).code, 'mcp.unauthorized');
  assert.equal((await client.request('team.escalate', { actor: parent, ...child }, 30_000, credentials.proof(child.session))).code, 'mcp.forbidden');
  assert.equal((await req('team.escalate', { actor: child.session, ...child })).code, 'team.forbidden');
  assert.equal((await req('team.escalate', { actor: parent, ...child, request: newId('req') })).code, 'session.already_decided');
  assert.equal(events(daemon.db, child.session, 'approval_request').length, 0);
  assert.equal((await approve(child, 'deny')).body.decided, true);
  assert.equal((await req('team.escalate', { actor: parent, ...child })).code, 'session.already_decided');
  await eventually(() => getSession(daemon.db, child.session).state === 'interrupted');
  const destructive = await spawn('rm -rf disposable-test-path');
  assert.equal((await req('team.escalate', { actor: parent, ...destructive })).code, 'session.already_decided');
});

for (const escalate of [false, true]) test(`confirmation-required handoffs remain delegated and can ${escalate ? 'escalate to the user' : 'be decided by the parent'}`, async t => {
  const { daemon, client, req, parent, spawn, approve, credentials } = await fixture(t);
  const child = await spawn();
  await approve(child, 'allow');
  await eventually(() => getSession(daemon.db, child.session).state === 'idle');
  const result = client.request('session.handoff', { session: child.session, to: { vendor: 'fake', model: 'unknown-price-model' }, mode: 'rehydrate', agentApproval: true }, 30_000, credentials.proof(child.session));
  await eventually(() => events(daemon.db, child.session, 'team_approval_request').some(e => e.approvalKind === 'handoff'));
  const handoff = events(daemon.db, child.session, 'team_approval_request').find(e => e.approvalKind === 'handoff');
  const target = { session: child.session, request: handoff.request };
  assert.equal(handoff.estimate.confirmRequired, true);
  assert.equal(events(daemon.db, child.session, 'approval_request').length, 0);
  if (escalate) {
    assert.equal((await req('team.escalate', { actor: parent, ...target, reason: 'large spend' })).body.escalated, true);
    assert.equal(events(daemon.db, child.session, 'approval_request')[0].approvalKind, 'handoff');
    assert.equal((await req('session.decide', { ...target, option: 'deny' })).body.decided, true);
  } else assert.equal((await approve(target, 'deny')).body.decided, true);
  assert.equal((await result).code, 'handoff.declined');
});

for (const active of [false, true]) for (const escalate of [false, true]) test(`urgent messages preserve ${escalate ? 'escalated' : 'delegated'} handoffs for ${active ? 'active' : 'idle'} children`, async t => {
  const { daemon, client, req, parent, spawn, approve, credentials } = await fixture(t);
  const child = await spawn();
  if (!active) {
    await approve(child, 'allow');
    await eventually(() => getSession(daemon.db, child.session).state === 'idle');
  }
  const pending = client.request('session.handoff', { session: child.session, to: { vendor: 'fake', model: 'unknown-price' }, mode: 'rehydrate', agentApproval: true }, 30_000, credentials.proof(child.session));
  await eventually(() => events(daemon.db, child.session, 'team_approval_request').some(e => e.approvalKind === 'handoff'));
  const request = events(daemon.db, child.session, 'team_approval_request').find(e => e.approvalKind === 'handoff').request;
  const target = { session: child.session, request };
  if (escalate) await req('team.escalate', { actor: parent, ...target });
  const response = await req('team.message', { actor: parent, to: child.session, text: 'Urgent context, not a cancellation', urgent: true });
  assert.equal(response.type, 'res', JSON.stringify(response));
  assert.equal(unreadTeamMessages(daemon.db, child.session).some(m => m.id === response.body.id), false);
  assert.ok(events(daemon.db, child.session, 'prompt').some(e => e.text.includes('Urgent context, not a cancellation')));
  assert.equal(events(daemon.db, child.session, 'interaction_expired').some(e => e.request === request), false);
  assert.equal(events(daemon.db, child.session, 'interrupted').length > 0, active);
  const decision = escalate
    ? await req('session.decide', { ...target, option: 'deny' })
    : await approve(target, 'deny');
  assert.equal(decision.body?.decided, true, JSON.stringify(decision));
  assert.equal((await pending).code, 'handoff.declined');
});

for (const escalate of [false, true]) test(`denying a preserved ${escalate ? 'escalated' : 'delegated'} handoff after its follow-up turn ends drains queued work`, async t => {
  const { daemon, client, req, parent, spawn, approve, credentials } = await fixture(t);
  const child = await spawn();
  const pending = client.request('session.handoff', { session: child.session, to: { vendor: 'fake', model: 'unknown-price' }, mode: 'rehydrate', agentApproval: true }, 30_000, credentials.proof(child.session));
  await eventually(() => events(daemon.db, child.session, 'team_approval_request').some(e => e.approvalKind === 'handoff'));
  const request = events(daemon.db, child.session, 'team_approval_request').find(e => e.approvalKind === 'handoff').request;
  await req('team.message', { actor: parent, to: child.session, text: 'follow up', urgent: true });
  let followup;
  await eventually(() => (followup = events(daemon.db, child.session, 'team_approval_request').find(e => e.request !== child.request && e.approvalKind !== 'handoff')));
  await approve({ session: child.session, request: followup.request }, 'allow');
  await eventually(() => getSession(daemon.db, child.session).state === 'idle');
  if (escalate) await req('team.escalate', { actor: parent, session: child.session, request });
  addQueuedPrompt(daemon.db, child.session, { id: newId('q'), text: 'queued after follow-up', createdAt: Date.now() });
  const decision = escalate
    ? await req('session.decide', { session: child.session, request, option: 'deny' })
    : await approve({ session: child.session, request }, 'deny');
  assert.equal(decision.body?.decided, true, JSON.stringify(decision));
  assert.equal((await pending).code, 'handoff.declined');
  await eventually(() => events(daemon.db, child.session, 'prompt').some(e => e.text === 'queued after follow-up'));
  assert.equal(listQueuedPrompts(daemon.db, child.session).length, 0);
});

for (const escalate of [false, true]) for (const method of ['session.abort', 'team.cancel']) test(`${escalate ? 'escalated' : 'delegated'} handoffs cannot start a replacement after ${method}`, async t => {
  const { daemon, client, req, parent, spawn, credentials } = await fixture(t);
  const child = await spawn();
  const pending = client.request('session.handoff', { session: child.session, to: { vendor: 'fake', model: 'unknown-price' }, mode: 'rehydrate', agentApproval: true }, 30_000, credentials.proof(child.session));
  await eventually(() => events(daemon.db, child.session, 'team_approval_request').some(e => e.approvalKind === 'handoff'));
  const request = events(daemon.db, child.session, 'team_approval_request').find(e => e.approvalKind === 'handoff').request;
  if (escalate) await req('team.escalate', { actor: parent, session: child.session, request });
  const aborted = await req(method, { ...(method === 'team.cancel' ? { actor: parent } : {}), session: child.session });
  assert.equal(aborted.type, 'res', JSON.stringify(aborted));
  assert.equal((await pending).code, 'handoff.declined');
  assert.equal(events(daemon.db, child.session, 'interaction_expired').find(e => e.request === request).reason, 'cancelled');
  assert.equal((await req('session.decide', { session: child.session, request, option: 'approve' })).type, 'err');
  assert.equal(daemon.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE parent = ?').get(child.session).n, 0);
  assert.equal(getSession(daemon.db, child.session).handed_off, 0);
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
