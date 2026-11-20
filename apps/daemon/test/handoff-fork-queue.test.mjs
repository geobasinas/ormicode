import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, getSession, listSessions, addQueuedPrompt, listQueuedPrompts, setState } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { EMPTY } from '@ormicode/pricing';
import { handoffRequest } from '../src/handoff-dispatch.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';
import { resumeSession } from '../src/team-resume.ts';
import { stateFor } from '../src/supervisor-state.ts';

for (const invalid of [false, true]) test(`fork ${invalid ? 'surfaces an absent untracked reference without transferring any work' : 'transfers valid file references and continues queued work after Resume'}`, async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'ormi-fork-queue-')); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('init', '-qb', 'main'); writeFileSync(join(cwd, 'common.txt'), 'tracked'); git('add', 'common.txt');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base');
  writeFileSync(join(cwd, 'local-only.txt'), 'untracked');
  const db = openStore(':memory:'); t.after(() => db.close());
  createSession(db, { id: 'old', machine: 'm', project: cwd, cwd, vendor: 'fake', transport: 'cli', branch: 'main' });
  const held = { text: 'held work', context: [{ kind: 'file', path: 'common.txt' }] };
  const queue = [{ id: 'first', text: 'first queued', createdAt: 1, context: [{ kind: 'file', path: invalid ? 'local-only.txt' : 'common.txt' }] },
    { id: 'second', text: 'second queued', createdAt: 2, context: [{ kind: 'file', path: 'common.txt' }] }];
  for (const item of queue) addQueuedPrompt(db, 'old', item);
  const stopped = [], replies = [], errors = [], sent = [];
  const ctx = { db, notesDir: join(cwd, 'notes'), paused: new Set(['old']), heldPrompts: new Map([['old', [held]]]),
    handoffsInTurn: new Map(), prices: { table: () => EMPTY }, spawnWorker() {}, teamLifecycle: { available() {} }, teamApprovals: { waiting: () => false },
    ensureWorker: async session => {
      if (session === 'old') return;
      const fork = getSession(db, session);
      assert.notEqual(fork.cwd, cwd); assert.equal(existsSync(join(fork.cwd, 'local-only.txt')), false);
      assert.equal(existsSync(join(fork.cwd, 'common.txt')), true);
    },
    stopWorker: async session => { stopped.push(session); }, services: { stopSession: async () => {} },
    record(session, kind, payload) { append(db, session, { kind, payload }); const state = kind === 'state' ? payload.state : stateFor[kind]; if (state) setState(db, session, state); },
  };
  Object.assign(ctx, createPromptDelivery({ ...ctx, lastPrompt: new Map(), ensureWorker: async () => {},
    toWorker: async (session, _method, body) => { sent.push({ session, text: body.text }); ctx.record(session, 'turn_start', {}); return { type: 'res' }; },
  }));
  await handoffRequest(ctx, { link: { reply: (_id, body) => replies.push(body), replyError: (_id, code, message) => errors.push({ code, message }) } }, 'handoff', { session: 'old', mode: 'fork', to: {}, confirmed: true });
  let owner;
  if (invalid) {
    assert.deepEqual(replies, []); assert.equal(errors[0].code, 'handoff.failed');
    assert.match(errors[0].message, /Queued prompt first cannot be transferred/); assert.match(errors[0].message, /local-only\.txt/);
    assert.equal(stopped.includes('old'), false); assert.deepEqual(sent, []);
    assert.equal(getSession(db, 'old').handed_off, 0); assert.equal(listSessions(db).length, 1);
    assert.deepEqual(listQueuedPrompts(db, 'old'), queue); assert.deepEqual(ctx.heldPrompts.get('old'), [held]);
    assert.match(JSON.parse(replay(db, 'old').find(e => e.kind === 'handoff_failed').payload).reason, /Queued prompt first/);
    owner = 'old';
  } else {
    assert.deepEqual(errors, []); owner = replies[0].session;
    assert.equal(getSession(db, 'old').handed_off, 1); assert.deepEqual(listQueuedPrompts(db, 'old'), []);
    assert.deepEqual(listQueuedPrompts(db, owner), queue); assert.equal(sent.length, 1);
    ctx.record(owner, 'turn_end', {}); await ctx.drainQueue(owner); assert.equal(sent.length, 1);
  }
  assert.equal(ctx.paused.has(owner), true);
  assert.equal(await resumeSession(ctx, owner), true); assert.match(sent.at(-1).text, /^held work/);
  for (const item of queue) { ctx.record(owner, 'turn_end', {}); await ctx.drainQueue(owner); assert.match(sent.at(-1).text, new RegExp(`^${item.text}`)); }
  assert.deepEqual(listQueuedPrompts(db, owner), []);
});
