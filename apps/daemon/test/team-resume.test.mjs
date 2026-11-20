import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { newId } from '@ormicode/protocol';
import { openStore, createSession, createTeam, setSessionTeam, setState, getSession, addQueuedPrompt, addTeamMessage, listQueuedPrompts, unreadTeamMessages } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { startDaemon, connect } from '../src/index.ts';
import { recoverSessions } from '../src/recovery.ts';
import { beforeWorkerResume, workerReadiness } from '../src/team-resume.ts';
import { TestMcpCredentials } from './mcp-fixture.mjs';

async function eventually(check) {
  const deadline = Date.now() + 15_000;
  while (!check()) { if (Date.now() >= deadline) assert.fail('timed out waiting for team resume'); await setTimeout(20); }
}
const events = (db, session, kind) => replay(db, session).filter(e => e.kind === kind).map(e => JSON.parse(e.payload));

async function fixture(t, policy = 'safe') {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-team-resume-')), project = join(dir, 'project'), storePath = join(dir, 'db');
  mkdirSync(project); execFileSync('git', ['init', '-q', project]); writeFileSync(join(project, 'hello'), 'hello');
  execFileSync('git', ['add', 'hello'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], { cwd: project });
  const previous = Object.fromEntries(['ORMICODE_HOME', 'ORMICODE_FAKE_SCRIPT', 'ORMICODE_FAKE_DELAY_MS', 'ORMICODE_RESUME_POLICY'].map(k => [k, process.env[k]]));
  Object.assign(process.env, { ORMICODE_HOME: join(dir, 'home'), ORMICODE_FAKE_SCRIPT: 'slow', ORMICODE_FAKE_DELAY_MS: '60000', ORMICODE_RESUME_POLICY: policy });
  const db = openStore(storePath), parent = newId('s'), team = newId('t'), children = Array.from({ length: 4 }, () => newId('s'));
  for (const id of [...children, parent]) createSession(db, { id, machine: 'm', project, vendor: 'fake', transport: 'cli', cwd: project, model: 'test', effort: 'test', mode: 'default', ...(id !== parent ? { parent } : {}) });
  createTeam(db, { id: team, parent, project });
  for (const id of [parent, ...children]) setSessionTeam(db, id, team);
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.concurrent', '1');
  const credentials = new TestMcpCredentials();
  let daemon, client;
  t.after(async () => { client?.close(); if (daemon) await daemon.close(); for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(dir, { recursive: true, force: true }); });
  return { dir, db, parent, team, children, async start() {
    db.close(); daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath, mcpCredentials: credentials }); client = await connect(daemon.socketPath);
    const req = (method, body) => client.request(method, body, 30_000, method.startsWith('team.') ? credentials.proof(body.actor) : undefined);
    return { daemon, req };
  } };
}

test('restart wakes the parent first, resumes queued/interrupted work under the cap and leaves empty children dormant', async t => {
  const f = await fixture(t), [queued, interrupted, inbox, dormant] = f.children;
  addQueuedPrompt(f.db, queued, { id: newId('q'), text: 'queued child work', createdAt: Date.now() });
  append(f.db, interrupted, { kind: 'prompt', payload: { text: 'unfinished task' } }); setState(f.db, interrupted, 'running');
  addTeamMessage(f.db, { id: newId('q'), team: f.team, from_session: f.parent, to_session: inbox, reply_to: null, body: 'queued inbox work', urgent: 0, created_at: Date.now() });
  const { daemon, req } = await f.start();
  await eventually(() => f.children.some(s => getSession(daemon.db, s).state === 'running'));
  assert.equal(daemon.workers.get(f.parent).ready, true); assert.equal(daemon.workers.has(dormant), false);
  assert.equal(f.children.filter(s => ['starting', 'running'].includes(getSession(daemon.db, s).state)).length, 1);
  const first = f.children.find(s => getSession(daemon.db, s).state === 'running');
  const order = daemon.db.prepare("SELECT session, kind FROM events WHERE kind IN ('resumed', 'turn_start') ORDER BY rowid").all();
  assert.ok(order.findIndex(e => e.session === f.parent && e.kind === 'resumed') < order.findIndex(e => e.session === first && e.kind === 'turn_start'));
  assert.ok(listQueuedPrompts(daemon.db, interrupted).length || events(daemon.db, interrupted, 'prompt').some(e => e.text.includes('Resume your interrupted team task')));
  const remaining = new Set([queued, interrupted, inbox]);
  for (let n = 0; n < 3; n++) {
    await eventually(() => [...remaining].some(s => getSession(daemon.db, s).state === 'running'));
    const child = [...remaining].find(s => getSession(daemon.db, s).state === 'running'); remaining.delete(child);
    assert.equal(f.children.filter(s => ['starting', 'running'].includes(getSession(daemon.db, s).state)).length, 1);
    const result = await req('team.cancel', { actor: f.parent, session: child }); assert.equal(result.type, 'res', JSON.stringify(result));
  }
  assert.equal(daemon.workers.has(dormant), false); assert.equal(unreadTeamMessages(daemon.db, inbox).length, 0);
});

test('parent session.resume is the team entry; status does not wake children but wait/message/reassign targets do', async t => {
  const f = await fixture(t, 'wait'), [waited, messaged, reassigned, dormant] = f.children;
  const { daemon, req } = await f.start();
  assert.equal(daemon.workers.size, 0);
  const result = await req('session.resume', { session: f.parent }); assert.equal(result.body.resumed, true);
  assert.equal(daemon.workers.get(f.parent).ready, true);
  for (const child of f.children) assert.equal(daemon.workers.has(child), false);
  await req('team.status', { actor: f.parent, session: waited }); assert.equal(daemon.workers.has(waited), false);
  const wake = await req('team.status', { actor: f.parent, session: waited, wake: true }); assert.equal(wake.type, 'res', JSON.stringify(wake));
  assert.equal(daemon.workers.get(waited).ready, true);
  const message = await req('team.message', { actor: f.parent, to: messaged, text: 'wake only this child' }); assert.equal(message.type, 'res', JSON.stringify(message));
  await eventually(() => getSession(daemon.db, messaged).state === 'running');
  const reassign = await req('team.reassign', { actor: f.parent, session: reassigned, task: 'replacement task' }); assert.equal(reassign.body.accepted, true);
  assert.equal(daemon.workers.has(reassigned), false, 'cap keeps targeted work queued');
  assert.equal(listQueuedPrompts(daemon.db, reassigned)[0].text, 'replacement task');
  await req('team.cancel', { actor: f.parent, session: messaged });
  await eventually(() => getSession(daemon.db, reassigned).state === 'running');
  assert.equal(daemon.workers.has(dormant), false);
});

test('all recovery never eagerly respawns child workers; wait policy preserves queued work', async t => {
  const f = await fixture(t, 'wait');
  setState(f.db, f.parent, 'running'); setState(f.db, f.children[0], 'running');
  assert.deepEqual(recoverSessions(f.db, 'all').autoResume.map(c => c.s.id), [f.parent]);
  assert.equal(listQueuedPrompts(f.db, f.children[0]).length, 1);
  assert.deepEqual(recoverSessions(f.db, 'wait').autoResume, []);
  assert.equal(listQueuedPrompts(f.db, f.children[0]).length, 1);
  f.db.close();
});

test('concurrent readiness reserves a child slot across asynchronous spawn, deduplicates callers and rejects closed children', async t => {
  const f = await fixture(t, 'wait'), ready = new Set(), existing = new Set(), pending = new Set(), spawned = [], ctx = { db: f.db };
  let stopped = false;
  ctx.ensureWorker = workerReadiness({ ready: s => ready.has(s), exists: s => existing.has(s), pending: s => pending.has(s), failure: () => undefined, closed: () => stopped,
    before: s => beforeWorkerResume(ctx, s, () => stopped), spawn(s) { spawned.push(s); pending.add(s); setTimeout(10).then(() => { if (stopped) return; pending.delete(s); existing.add(s); ready.add(s); setState(f.db, s, s === f.parent ? 'idle' : 'running'); }); } });
  const first = ctx.ensureWorker(f.children[0]), duplicate = ctx.ensureWorker(f.children[0]), second = ctx.ensureWorker(f.children[1]);
  assert.equal(first, duplicate); await first;
  assert.deepEqual(spawned, [f.parent, f.children[0]]);
  setState(f.db, f.children[0], 'idle'); await second;
  assert.deepEqual(spawned, [f.parent, f.children[0], f.children[1]]);
  f.db.prepare('UPDATE teams SET closed_at = ? WHERE id = ?').run(Date.now(), f.team);
  await assert.rejects(ctx.ensureWorker(f.children[2]), /team.closed/);
  stopped = true; await assert.rejects(ctx.ensureWorker(f.children[3]), /closing/); f.db.close();
});
