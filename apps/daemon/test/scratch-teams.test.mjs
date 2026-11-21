import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { startDaemon, connect } from '../src/index.ts';
import { spawnTeamChild } from '../src/team-spawn.ts';
import { callTeamTool } from '../src/team-mcp.ts';
import { scratchWorkspaceInUse } from '../src/scratch-methods.ts';
import { newId, parseResponseBody } from '@ormicode/protocol';
import { openStore, createSession, getSession, ownedTeam, teamChildren, archiveSession, setState } from '@ormicode/session-store';
import { acquireWorkspace } from '@ormicode/leases';
import { replay } from '@ormicode/journal';
import { TestMcpCredentials } from './mcp-fixture.mjs';

async function eventually(check) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('timed out waiting for scratch teammate');
    await setTimeout(20);
  }
}
test('scratch roster is implicit, first spawn shares cwd, children share a team, and deleting them keeps the lead files', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-scratch-team-'));
  const savedHome = process.env.ORMICODE_HOME;
  process.env.ORMICODE_HOME = join(dir, 'home');
  const credentials = new TestMcpCredentials();
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db'), mcpCredentials: credentials });
  const link = await connect(daemon.socketPath);
  t.after(async () => {
    link.close(); await daemon.close();
    if (savedHome === undefined) delete process.env.ORMICODE_HOME; else process.env.ORMICODE_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  });
  const req = (method, body) => link.request(method, body, 30000, method.startsWith('team.') ? credentials.proof(body.actor) : undefined);
  const started = await req('session.start', { machine: newId('m'), project: 'scratch', vendor: 'fake', transport: 'cli',
    model: 'default', effort: 'default', mode: 'default', workspace: { kind: 'scratch' } });
  assert.equal(started.type, 'res', JSON.stringify(started));
  const parent = started.body.session, cwd = getSession(daemon.db, parent).cwd;
  const roster = await req('team.tree', { actor: parent });
  assert.equal(roster.type, 'res', JSON.stringify(roster));
  assert.deepEqual(roster.body, { team: null, parent, children: [] });
  assert.equal(parseResponseBody('team.tree', roster.body).success, true);
  assert.equal(getSession(daemon.db, parent).team, null);
  assert.equal(ownedTeam(daemon.db, parent), undefined);
  const tool = await callTeamTool('team_roster', {}, parent, async (method, body) => {
    const result = await req(method, body); assert.equal(result.type, 'res'); return result.body;
  }, async () => 'unused');
  assert.deepEqual(JSON.parse(tool), roster.body);
  writeFileSync(join(cwd, 'shared.txt'), 'lead file');
  const children = [];
  let team;
  for (const task of ['first scratch task', 'second scratch task']) {
    const result = await req('team.spawn', { actor: parent, task });
    assert.equal(result.type, 'res', JSON.stringify(result));
    const child = getSession(daemon.db, result.body.session);
    assert.equal(child.cwd, cwd); assert.equal(child.project, 'scratch'); assert.equal(child.worktree, null);
    assert.equal(child.parent, parent);
    if (team) assert.equal(result.body.team, team);
    team = result.body.team; children.push(child.id);
    await eventually(() => replay(daemon.db, child.id).some(e => e.kind === 'turn_end'));
    assert.ok(replay(daemon.db, child.id).some(e => e.kind === 'text' && JSON.parse(e.payload).text.includes(task)));
  }
  const populated = await req('team.tree', { actor: parent });
  assert.equal(populated.body.parent, parent); assert.equal(populated.body.team, team);
  assert.deepEqual(new Set(populated.body.children.map(c => c.session)), new Set(children));
  assert.equal((await req('team.tree', { actor: children[0] })).code, 'team.forbidden');
  assert.equal(daemon.db.prepare('SELECT session FROM leases WHERE path = ?').get(cwd).session, parent);
  const project = join(dir, 'copy-target'); mkdirSync(project);
  const copied = await req('session.copyOut', { session: children[0], paths: ['shared.txt'], project });
  assert.equal(copied.type, 'res', JSON.stringify(copied));
  assert.equal(readFileSync(join(project, 'shared.txt'), 'utf8'), 'lead file');
  assert.equal((await req('session.delete', { session: children[0] })).type, 'res');
  assert.equal(readFileSync(join(cwd, 'shared.txt'), 'utf8'), 'lead file');
  assert.equal(daemon.db.prepare('SELECT session FROM leases WHERE path = ?').get(cwd).session, parent);
  assert.equal((await req('session.delete', { session: parent })).type, 'res');
  assert.ok(existsSync(join(cwd, 'shared.txt')), 'remaining teammate keeps the shared folder');
  assert.equal((await req('session.delete', { session: children[1] })).type, 'res');
  assert.ok(existsSync(cwd), 'teammates never delete the lead workspace');
  await req('session.delete', { session: parent });
  assert.equal(existsSync(cwd), false, 'the owner can delete the folder once no teammate uses it');
});

test('scratch cleanup protects live and archived-but-running workspace users', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  assert.equal(scratchWorkspaceInUse(db, '/scratch', 'lead'), false);
  createSession(db, { id: 'child', parent: 'lead', machine: 'm', project: 'scratch', cwd: '/scratch', vendor: 'fake', transport: 'cli' });
  assert.equal(scratchWorkspaceInUse(db, '/scratch', 'lead'), true);
  archiveSession(db, 'child'); setState(db, 'child', 'running');
  assert.equal(scratchWorkspaceInUse(db, '/scratch', 'lead'), true);
  setState(db, 'child', 'idle');
  assert.equal(scratchWorkspaceInUse(db, '/scratch', 'lead'), false);
  assert.equal(scratchWorkspaceInUse(db, '/other', 'lead'), false);
});

test('a Claude SDK scratch lead can request Codex in the same cwd without launching a real adapter', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-scratch-codex-'));
  const previousHome = process.env.ORMICODE_HOME; process.env.ORMICODE_HOME = join(dir, 'home');
  const db = openStore(':memory:');
  t.after(() => {
    db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    if (previousHome === undefined) delete process.env.ORMICODE_HOME; else process.env.ORMICODE_HOME = previousHome;
  });
  const parentId = newId('s'), cwd = join(dir, 'home', 'scratch', parentId);
  mkdirSync(cwd, { recursive: true });
  createSession(db, { id: parentId, machine: newId('m'), project: 'scratch', cwd, vendor: 'claude', transport: 'sdk' });
  acquireWorkspace(db, cwd, parentId, getSession(db, parentId).machine);
  const spawned = [], prompts = [];
  const ctx = { db, secrets: { missing: () => [] }, spawnWorker: session => spawned.push(session), record: () => {},
    sendPrompt: async (session, text) => { prompts.push({ session, text }); return true; }, stopWorker: async () => {} };
  let response;
  const client = { link: { reply: (_id, body) => { response = { type: 'res', body }; },
    replyError: (_id, code, message) => { response = { type: 'err', code, message }; } } };
  const spawn = body => spawnTeamChild(ctx, client, 'test', body, getSession(db, parentId));
  await spawn({ task: 'codex task', vendor: 'codex' });
  assert.equal(response.type, 'res', JSON.stringify(response));
  const child = getSession(db, response.body.session);
  assert.equal(child.vendor, 'codex'); assert.equal(child.transport, 'sdk'); assert.equal(child.cwd, cwd);
  assert.deepEqual(spawned, [child.id]); assert.equal(prompts[0].session, child.id);
  assert.match(prompts[0].text, /codex task/);
  assert.equal(db.prepare('SELECT session FROM leases WHERE path = ?').get(cwd).session, parentId);
  await spawn({ task: 'bad adapter', vendor: 'unsupported', transport: 'cli' });
  assert.equal(response.code, 'agent.unsupported');
  assert.equal(teamChildren(db, ownedTeam(db, parentId).id).length, 1);
  rmSync(cwd, { recursive: true, maxRetries: 10, retryDelay: 200});
  await spawn({ task: 'missing scratch', vendor: 'codex' });
  assert.equal(response.code, 'workspace.not_found'); assert.match(response.message, /workspace directory not found/);
  assert.equal(teamChildren(db, ownedTeam(db, parentId).id).length, 1);
});
