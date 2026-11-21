import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, getSession, createTeam, setSessionTeam, archiveSession } from '@ormicode/session-store';
import { append } from '@ormicode/journal';
import { sessionTeamView } from '../src/session-team-view.ts';
import { TeamApprovals } from '../src/team-approvals.ts';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';

test('device read model includes membership and cache-inclusive usage, including archived team descendants but not handoffs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'team-view-')), db = openStore(join(dir, 'db'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); });
  for (const id of ['parent', 'child', 'handoff']) createSession(db, { id, machine: 'm', project: 'p', vendor: 'fake', transport: 'cli', cwd: dir, ...(id === 'parent' ? {} : { parent: 'parent' }) });
  createTeam(db, { id: 'team', parent: 'parent', project: 'p' });
  for (const id of ['parent', 'child']) setSessionTeam(db, id, 'team');
  assert.deepEqual(sessionTeamView(db, getSession(db, 'child')), { parent: 'parent', team: 'team', tokens: 0, teamTokens: 0 });
  append(db, 'parent', { kind: 'usage', payload: { input: 100, output: 20, cacheRead: 30, cacheWrite: 10 } });
  append(db, 'child', { kind: 'usage', payload: { input: 200, output: 40 } });
  append(db, 'handoff', { kind: 'usage', payload: { input: 900 } }); archiveSession(db, 'child');
  assert.equal(sessionTeamView(db, getSession(db, 'parent')).tokens, 160);
  assert.equal(sessionTeamView(db, getSession(db, 'parent')).teamTokens, 400);
  assert.equal(sessionTeamView(db, getSession(db, 'child')).tokens, 240);
});

test('parent approval read model is scoped, once-only, and clears on decision or user fallback', t => {
  const dir = mkdtempSync(join(tmpdir(), 'team-approval-view-')), db = openStore(join(dir, 'db'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); });
  for (const id of ['parent', 'child']) createSession(db, { id, machine: 'm', project: 'p', vendor: 'fake', transport: 'cli', cwd: dir, ...(id === 'child' ? { parent: 'parent' } : {}) });
  createTeam(db, { id: 'team', parent: 'parent', project: 'p' }); setSessionTeam(db, 'child', 'team');
  const approvals = new TeamApprovals(() => ({ db, record: () => {}, drainQueue: async () => true }), () => true);
  const payload = { request: 'request', tool: 'Bash', input: { command: 'echo safe' }, options: [{ id: 'allow', label: 'Allow once' }, { id: 'deny', label: 'Deny once' }, { id: 'always', label: 'Always' }] };
  assert.deepEqual(approvals.forParent('parent'), []);
  assert.equal(approvals.event('child', 'approval_request', payload)[0], 'team_approval_request');
  assert.deepEqual(approvals.forParent('parent')[0].options.map(o => o.id), ['allow', 'deny']);
  assert.deepEqual(approvals.forParent('child'), []);
  approvals.event('child', 'approval_decision', { request: 'request', option: 'allow' }); assert.deepEqual(approvals.forParent('parent'), []);
  approvals.event('child', 'approval_request', payload); approvals.unavailable('parent'); assert.deepEqual(approvals.forParent('parent'), []);
});

test('reopening a session replays event kinds and only that session history', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'team-replay-')), home = process.env.ORMICODE_HOME;
  process.env.ORMICODE_HOME = dir;
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'db') });
  const client = await connect(daemon.socketPath);
  t.after(async () => { client.close(); await daemon.close(); if (home === undefined) delete process.env.ORMICODE_HOME; else process.env.ORMICODE_HOME = home; rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); });
  const parent = newId('s'), child = newId('s');
  for (const id of [parent, child]) createSession(daemon.db, { id, machine: 'm', project: 'p', vendor: 'fake', transport: 'cli', cwd: dir });
  append(daemon.db, parent, { kind: 'text', payload: { text: 'parent history' } });
  append(daemon.db, child, { kind: 'text', payload: { text: 'child history' } });
  const events = []; client.onFrame = frame => { if (frame.type === 'evt') events.push(frame); };
  assert.equal((await client.request('session.subscribe', { session: parent })).type, 'res');
  assert.deepEqual(events.map(e => [e.session, e.body.kind, e.body.text]), [[parent, 'text', 'parent history']]);
  events.length = 0;
  assert.equal((await client.request('session.subscribe', { session: child })).type, 'res');
  assert.deepEqual(events.map(e => [e.session, e.body.kind, e.body.text]), [[child, 'text', 'child history']]);
});
