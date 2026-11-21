import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { startDaemon, connect } from '../src/index.ts';
import { TestMcpCredentials } from './mcp-fixture.mjs';
import { newId } from '@ormicode/protocol';
import { getSession } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';

const events = (db, session, kind) => replay(db, session).filter(e => e.kind === kind).map(e => JSON.parse(e.payload));
async function eventually(check) {
  const deadline = Date.now() + 15_000;
  while (!check()) { if (Date.now() > deadline) assert.fail('timed out'); await setTimeout(10); }
}
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-team-user-')), project = join(dir, 'project'), remote = join(dir, 'remote.git');
  mkdirSync(project);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(project, 'init', '-qb', 'main'); git(project, 'init', '--bare', '-q', remote);
  writeFileSync(join(project, 'hello.txt'), 'initial\n'); git(project, 'add', 'hello.txt');
  git(project, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial');
  git(project, 'remote', 'add', 'origin', remote);
  const gh = join(dir, 'gh'), log = join(dir, 'gh.log');
  writeFileSync(gh, `#!${process.execPath}\nimport('node:fs').then(fs => { fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n'); if(fs.existsSync(${JSON.stringify(join(dir, 'fail'))})) { console.error('not logged into github'); process.exitCode=1; } else console.log('https://github.com/test/repo/pull/42'); });\n`, { mode: 0o755 });
  const saved = Object.fromEntries(['ORMICODE_HOME', 'ORMICODE_FAKE_SCRIPT', 'ORMICODE_GH'].map(k => [k, process.env[k]]));
  process.env.ORMICODE_HOME = join(dir, 'home'); process.env.ORMICODE_FAKE_SCRIPT = 'echo'; process.env.ORMICODE_GH = gh;
  const credentials = new TestMcpCredentials();
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db'), mcpCredentials: credentials });
  const client = await connect(daemon.socketPath);
  t.after(async () => {
    client.close(); await daemon.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  });
  const req = (method, body) => client.request(method, body, 30_000, method.startsWith('team.') || method === 'session.askUser' ? credentials.proof(body.actor ?? body.session) : undefined);
  const started = await req('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'test', effort: 'test', mode: 'acceptEdits', workspace: { kind: 'current' } });
  assert.equal(started.type, 'res', JSON.stringify(started));
  const parent = started.body.session;
  const spawned = await req('team.spawn', { actor: parent, task: 'implement child' });
  assert.equal(spawned.type, 'res', JSON.stringify(spawned));
  const child = spawned.body.session;
  await eventually(() => ['idle', 'done'].includes(getSession(daemon.db, child)?.state) && events(daemon.db, child, 'turn_end').length);
  const row = getSession(daemon.db, child);
  writeFileSync(join(row.cwd, 'hello.txt'), 'child implementation\n'); git(row.cwd, 'add', 'hello.txt');
  git(row.cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'child change');
  const lastRequest = kind => events(daemon.db, parent, kind).at(-1);
  const pendingPr = async (extra = {}) => {
    const count = events(daemon.db, parent, 'approval_request').length;
    const response = req('team.openPr', { actor: parent, session: child, title: 'Child change', body: 'Details', ...extra });
    let failure; response.then(r => { if (r.type === 'err') failure = r; });
    await eventually(() => { assert.equal(failure, undefined, JSON.stringify(failure)); return events(daemon.db, parent, 'approval_request').length > count; });
    return { response, approval: lastRequest('approval_request') };
  };
  return { dir, project, remote, log, git, daemon, client, req, parent, child, row, credentials, lastRequest, pendingPr };
}

test('team and plain user questions reach Needs You, enforce actor/parent permissions and return one answer', async t => {
  const f = await fixture(t), { daemon, req, client, parent, child, credentials } = f;
  assert.equal((await client.request('session.askUser', { session: parent, question: 'Spoof?' })).code, 'mcp.unauthorized');
  assert.equal((await client.request('session.askUser', { session: parent, question: 'Spoof?' }, 30_000, credentials.proof(child))).code, 'mcp.forbidden');
  for (const method of ['team.askUser', 'session.askUser']) {
    assert.equal((await req(method, { actor: child, session: child, question: 'Bypass?' })).code, 'team.forbidden');
    let resolved = false;
    const pending = req(method, { actor: parent, session: parent, question: method, options: method === 'team.askUser' ? ['Yes', 'No'] : [] }).then(r => { resolved = true; return r; });
    await eventually(() => f.lastRequest('question_request')?.questions[0].question === method);
    const question = f.lastRequest('question_request');
    assert.equal(getSession(daemon.db, parent).state, 'awaiting_input'); assert.equal(resolved, false);
    assert.equal((await req('team.tree', { actor: parent })).type, 'res', 'question does not hold the team lock');
    for (const answer of ['', '   ', ...(method === 'team.askUser' ? ['Unoffered'] : [])])
      assert.equal((await req('session.answer', { session: parent, request: question.request, answers: { [method]: answer } })).code, answer === '' ? 'protocol.invalid_frame' : 'team.invalid');
    const answers = { [method]: method === 'team.askUser' ? 'Yes' : 'A written answer' };
    assert.equal((await req('session.answer', { session: parent, request: question.request, answers })).type, 'res');
    assert.deepEqual((await pending).body, { request: question.request, answers });
    assert.equal((await req('session.answer', { session: parent, request: question.request, answers })).code, 'session.already_decided');
    assert.ok(['idle', 'done'].includes(getSession(daemon.db, parent).state));
  }
  assert.equal((await req('team.askUser', { actor: parent, question: '  ' })).code, 'team.invalid');
  assert.equal((await req('team.askUser', { actor: parent, question: 'Duplicate?', options: ['A', 'A'] })).code, 'team.invalid');
});

test('PR opening is parent-only, user-only and denial performs no outward action', async t => {
  const f = await fixture(t), { req, parent, child, daemon, git, remote, row, log, client, credentials } = f;
  assert.equal((await req('team.openPr', { actor: child, session: child, title: 'No', body: '' })).code, 'team.forbidden');
  const { response, approval } = await f.pendingPr();
  assert.equal(approval.userOnly, true); assert.equal(approval.approvalKind, 'team_open_pr');
  assert.equal(approval.input.head, git(row.cwd, 'rev-parse', 'HEAD')); assert.equal(approval.input.remote, remote);
  assert.equal(getSession(daemon.db, parent).state, 'awaiting_approval');
  assert.equal(events(daemon.db, parent, 'team_approval_request').length, 0);
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)'), ''); assert.equal(existsSync(log), false);
  assert.equal((await client.request('session.decide', { session: parent, request: approval.request, option: 'approve' }, 30_000, credentials.proof(parent))).code, 'mcp.forbidden');
  assert.equal((await req('team.approve', { actor: parent, session: parent, request: approval.request, option: 'approve', reason: 'self approve' })).type, 'err');
  assert.equal((await req('session.decide', { session: parent, request: approval.request, option: 'always' })).code, 'team.invalid');
  assert.equal((await req('session.decide', { session: parent, request: approval.request, option: 'deny' })).type, 'res');
  assert.equal((await response).code, 'git.confirm_required');
  assert.equal((await req('session.decide', { session: parent, request: approval.request, option: 'approve' })).code, 'session.already_decided');
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)'), ''); assert.equal(existsSync(log), false);
  assert.equal(events(daemon.db, parent, 'approval_decision').at(-1).parentDecided, false);
});

test('approved PR pushes only the approved commit and invokes the existing forge helper', async t => {
  const f = await fixture(t), { req, parent, row, remote, git, log, daemon } = f;
  const { response, approval } = await f.pendingPr({ draft: true, base: 'main' });
  assert.equal((await req('session.decide', { session: parent, request: approval.request, option: 'approve' })).type, 'res');
  const result = await response;
  assert.deepEqual(result.body, { number: 42, url: 'https://github.com/test/repo/pull/42' });
  assert.equal(git(remote, 'rev-parse', `refs/heads/${row.branch}`), approval.input.head);
  const args = JSON.parse(readFileSync(log, 'utf8').trim());
  assert.deepEqual(args.slice(0, 2), ['pr', 'create']); assert.ok(args.includes('--draft'));
  assert.equal(args[args.indexOf('--head') + 1], row.branch); assert.equal(args[args.indexOf('--base') + 1], 'main');
  assert.equal(events(daemon.db, parent, 'team_pr_result').at(-1).number, 42);
});

test('PR approval binds the commit and remote; changed repositories require new approval', async t => {
  const f = await fixture(t), { req, parent, row, git, remote, log } = f;
  for (const change of ['commit', 'remote']) {
    const { response, approval } = await f.pendingPr();
    if (change === 'commit') {
      writeFileSync(join(row.cwd, 'more.txt'), 'unapproved'); git(row.cwd, 'add', 'more.txt');
      git(row.cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'unapproved');
    } else git(row.cwd, 'remote', 'set-url', 'origin', join(f.dir, 'other.git'));
    await req('session.decide', { session: parent, request: approval.request, option: 'approve' });
    assert.match((await response).message, /repository changed/);
    assert.equal(git(remote, 'for-each-ref', '--format=%(refname)'), ''); assert.equal(existsSync(log), false);
  }
});

test('forge/auth and remote failures are explicit and do not create a PR', async t => {
  const f = await fixture(t), { req, parent, git, row, log } = f;
  writeFileSync(join(f.dir, 'fail'), '');
  let pending = await f.pendingPr();
  await req('session.decide', { session: parent, request: pending.approval.request, option: 'approve' });
  const failed = await pending.response;
  assert.equal(failed.code, 'git.failed'); assert.match(failed.message, /PRs are unavailable:.*not logged into github/s);
  assert.match(failed.message, /not rolled back/);
  const calls = readFileSync(log, 'utf8');
  git(row.cwd, 'remote', 'set-url', 'origin', join(f.dir, 'missing.git'));
  pending = await f.pendingPr();
  await req('session.decide', { session: parent, request: pending.approval.request, option: 'approve' });
  assert.equal((await pending.response).code, 'git.failed'); assert.equal(readFileSync(log, 'utf8'), calls);
});

test('plain ormi_ask_user stdio MCP returns the user answer with its authenticated session pinned', async t => {
  const f = await fixture(t), { req, parent, credentials } = f;
  const processMcp = spawn(process.execPath, ['apps/daemon/src/mcp-serve.ts'], {
    cwd: new URL('../../..', import.meta.url), env: { ...process.env, ORMICODE_SOCKET: f.daemon.socketPath, ORMI_SESSION: parent, ORMI_MCP_TOKEN: credentials.proof(parent).token }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => processMcp.kill());
  let output = ''; processMcp.stdout.on('data', chunk => { output += chunk; });
  processMcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ormi_ask_user', arguments: { session: f.child, question: 'MCP question?' } } }) + '\n');
  await eventually(() => f.lastRequest('question_request')?.questions[0].question === 'MCP question?');
  await req('session.answer', { session: parent, request: f.lastRequest('question_request').request, answers: { 'MCP question?': 'MCP answer' } });
  await eventually(() => output.includes('MCP answer'));
  const result = JSON.parse(output.trim()).result;
  assert.equal(JSON.parse(result.content[0].text).answers['MCP question?'], 'MCP answer');
});

test('archiving the asking session expires user-only PR approvals', async t => {
  const f = await fixture(t), { req, parent, daemon } = f;
  const { response, approval } = await f.pendingPr();
  await req('session.archive', { session: parent });
  assert.equal((await response).code, 'git.confirm_required');
  assert.equal(events(daemon.db, parent, 'interaction_expired').at(-1).request, approval.request);
});

test('team parent can publish its own branch and non-members cannot be selected', async t => {
  const f = await fixture(t), { req, parent, project, git } = f;
  assert.equal((await req('team.openPr', { actor: parent, session: newId('s'), title: 'No', body: '' })).code, 'team.not_member');
  git(project, 'switch', '-c', 'team-integration');
  const { response, approval } = await f.pendingPr({ session: parent, base: 'main' });
  await req('session.decide', { session: parent, request: approval.request, option: 'approve' });
  assert.equal((await response).body.number, 42);
});
