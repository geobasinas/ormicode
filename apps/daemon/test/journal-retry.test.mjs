import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore, createSession, setState, getSession } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';
import { journalPrompt } from '../src/prompt-recovery.ts';
import { retryPrompt } from '../src/prompt-methods.ts';
import { recoverSessions } from '../src/recovery.ts';
import { startDaemon, connect } from '../src/index.ts';

test('journal recovery handles latest text, context, attachments and invalid/empty history', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'prompt-recovery-')); const db = openStore(join(dir, 'store.db')); const session = newId('s');
 createSession(db, { id: session, machine: 'm', project: dir, vendor: 'fake', transport: 'cli', cwd: dir });
 let error, sent;
 const client = { link: { replyError: (_id, code, message) => { error = { code, message }; }, reply: () => {} } };
 const ctx = { db, lastPrompt: new Map(), sendPrompt: async (...args) => { sent = args; return true; } };
 try {
  assert.equal(journalPrompt(db, session), undefined);
  await retryPrompt(ctx, client, 'empty', { session }); assert.equal(error.code, 'session.not_found');
  append(db, session, { kind: 'prompt', payload: { text: 'old' } });
  mkdirSync(join(dir, '.ormi', 'attachments', 'a'), { recursive: true });
  writeFileSync(join(dir, '.ormi', 'attachments', 'a', 'file.txt'), 'saved contents');
  append(db, session, { kind: 'prompt', payload: { text: 'Team inbox: message\noriginal', retryText: 'original', context: [{ kind: 'file', path: 'source.txt' }], attachments: [{ name: 'file.txt', mimeType: 'text/plain', path: '.ormi/attachments/a/file.txt' }] } });
  await retryPrompt(ctx, client, 'retry', { session });
  assert.equal(sent[1], 'original'); assert.deepEqual(sent[3].context, [{ kind: 'file', path: 'source.txt' }]);
  assert.equal(Buffer.from(sent[3].attachments[0].data, 'base64').toString(), 'saved contents'); assert.equal(sent[3].journal, false);
  ctx.sendPrompt = async () => false;
  await retryPrompt(ctx, client, 'rejected', { session }); assert.equal(error.code, 'agent.failed');
  for (const payload of [{ text: '' }, { text: 'look', images: [{ name: 'Image', mimeType: 'image/png' }] }, { text: 'file', attachments: [{ name: 'missing', mimeType: 'text/plain', path: '.ormi/attachments/missing' }] }, { text: 'file', attachments: [{ name: 'unsafe', mimeType: 'text/plain', path: '.ormi/attachments/../../store.db' }] }]) {
   append(db, session, { kind: 'prompt', payload });
   await retryPrompt(ctx, client, 'invalid', { session }); assert.equal(error.code, 'prompt.invalid');
  }
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a fresh daemon retries a journal-only prompt and expires every unresolved native approval', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'retry-reboot-')); const storePath = join(dir, 'store.db'); const session = newId('s');
 const previous = { home: process.env.ORMICODE_HOME, policy: process.env.ORMICODE_RESUME_POLICY };
 process.env.ORMICODE_HOME = join(dir, 'home'); process.env.ORMICODE_RESUME_POLICY = 'wait';
 let daemon, client; const db = openStore(storePath);
 try {
  createSession(db, { id: session, machine: 'm', project: dir, vendor: 'fake', transport: 'cli', cwd: dir });
  append(db, session, { kind: 'prompt', payload: { text: 'retry after restart' } });
  for (const request of ['already-decided', 'pending-1', 'pending-2']) append(db, session, { kind: 'approval_request', payload: { request, options: [] } });
  append(db, session, { kind: 'approval_decision', payload: { request: 'already-decided', option: 'decline' } });
  setState(db, session, 'awaiting_approval'); db.close();
  daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath }); client = await connect(daemon.socketPath);
  assert.equal(getSession(daemon.db, session).reason, 'host_restart');
  const expired = () => replay(daemon.db, session).filter(e => e.kind === 'interaction_expired').map(e => JSON.parse(e.payload).request);
  assert.deepEqual(expired(), ['pending-1', 'pending-2']);
  recoverSessions(daemon.db, 'wait'); assert.deepEqual(expired(), ['pending-1', 'pending-2']);
  assert.equal((await client.request('session.retry', { session })).body.accepted, true);
  const deadline = Date.now() + 15_000;
  while (!replay(daemon.db, session).some(e => e.kind === 'turn_end')) { if (Date.now() > deadline) throw new Error('retry turn timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.ok(replay(daemon.db, session).some(e => e.kind === 'text' && JSON.parse(e.payload).text === 'retry after restart'));
  assert.equal(replay(daemon.db, session).filter(e => e.kind === 'prompt').length, 1);
 } finally {
  client?.close(); await daemon?.close(); if (db.open) db.close();
  for (const [key, value] of [['ORMICODE_HOME', previous.home], ['ORMICODE_RESUME_POLICY', previous.policy]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(dir, { recursive: true, force: true });
 }
});
