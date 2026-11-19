import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, getSession, listSessions, sessionsInStates, setState, setTitle, archiveSession, setNativeId,
  addDevice, getDeviceByHash, listDevices, renameDevice, revokeDevice, listNotes, setNote, deleteNote, getPinnedPrice, pinPrice,
  addQueuedPrompt, listQueuedPrompts, moveQueuedPrompt, removeQueuedPrompt, updateQueuedPrompt,
  setQueuedPromptError,
  setPendingPromptData, getPendingPromptData, getDraft, setDraft } from '../src/index.ts';

test('openStore applies migrations and is idempotent on reopen', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ormi-store-')), 'nested', 'store.db');
  const db = openStore(path);
  const version = db.pragma('user_version', { simple: true });
  assert.ok(version >= 6);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  db.close();
  const again = openStore(path);
  assert.equal(again.pragma('user_version', { simple: true }), version);
  again.close();
});

test('sessions: create, read, list order, state, title, archive', () => {
  const db = openStore(':memory:');
  const base = { machine: 'm', project: '/p', vendor: 'fake', transport: 'cli', cwd: '/p' };
  createSession(db, { ...base, id: 's_1', model: 'x', branch: 'main', now: 1 });
  createSession(db, { ...base, id: 's_2', agentArgs: ['--a'], now: 2 });
  const s1 = getSession(db, 's_1');
  assert.deepEqual([s1.state, s1.model, s1.branch, s1.kind, s1.archived], ['idle', 'x', 'main', 'session', 0]);
  assert.equal(getSession(db, 's_2').agent_args, '["--a"]');
  assert.deepEqual(listSessions(db).map(s => s.id), ['s_2', 's_1']);
  setState(db, 's_1', 'running', 'go', 10);
  assert.deepEqual([getSession(db, 's_1').state, getSession(db, 's_1').reason, getSession(db, 's_1').updated_at], ['running', 'go', 10]);
  assert.deepEqual(sessionsInStates(db, ['running', 'failed']).map(s => s.id), ['s_1']);
  setTitle(db, 's_2', 'Hello'); setNativeId(db, 's_2', 'native-1');
  assert.deepEqual([getSession(db, 's_2').title, getSession(db, 's_2').native_id], ['Hello', 'native-1']);
  archiveSession(db, 's_2');
  assert.deepEqual(listSessions(db).map(s => s.id), ['s_1']);
  assert.deepEqual(listSessions(db, true).map(s => s.id), ['s_2']);
  assert.equal(getSession(db, 's_missing'), undefined);
});

test('devices: add, lookup by hash, rename, revoke hides them', () => {
  const db = openStore(':memory:');
  addDevice(db, { id: 'd_1', name: 'Phone', tokenHash: 'h1' });
  assert.equal(getDeviceByHash(db, 'h1').name, 'Phone');
  assert.equal(renameDevice(db, 'd_1', 'Pixel'), true);
  assert.equal(revokeDevice(db, 'd_1'), true);
  assert.equal(revokeDevice(db, 'd_1'), false);
  assert.equal(getDeviceByHash(db, 'h1'), undefined);
  assert.equal(renameDevice(db, 'd_1', 'x'), false);
  assert.deepEqual([listDevices(db).length, listDevices(db, true)[0].name], [0, 'Pixel']);
});

test('notes: markdown files with a title front matter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-notes-'));
  const startedAt = Date.now();
  const id = setNote(dir, 's_1', { title: 'Plan', body: '- one\n' }, () => 'n_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  assert.equal(id, 'n_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  setNote(dir, 's_1', { id, title: 'Plan 2', body: 'two' }, () => 'unused');
  const [note] = listNotes(dir, 's_1');
  assert.deepEqual([note.id, note.title, note.body], [id, 'Plan 2', 'two']);
  assert.ok(note.updatedAt >= startedAt - 1_000);
  assert.ok(note.updatedAt <= Date.now() + 1_000);
  assert.deepEqual(listNotes(dir, 's_none'), []);
  assert.equal(deleteNote(dir, 's_1', id), true);
  assert.equal(deleteNote(dir, 's_1', id), false);
});

test('session prices pin a model price and keep the first version', () => {
  const db = openStore(':memory:');
  createSession(db, { id: 's_1', machine: 'm', project: '/p', vendor: 'fake', transport: 'cli', cwd: '/p' });
  const first = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  pinPrice(db, 's_1', 'claude-sonnet-4-6', first, 'openrouter-old');
  assert.deepEqual(getPinnedPrice(db, 's_1', 'claude-sonnet-4-6'), { price: first, version: 'openrouter-old' });
  pinPrice(db, 's_1', 'claude-sonnet-4-6', { input: 9, output: 30 }, 'openrouter-new');
  assert.deepEqual(getPinnedPrice(db, 's_1', 'claude-sonnet-4-6'), { price: first, version: 'openrouter-old' });
  assert.ok(db.pragma('user_version', { simple: true }) >= 4);
  db.close();
});

test('queued prompts retain order, edits, and images across a store restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ormi-queue-')), 'store.db');
  let db = openStore(path);
  createSession(db, { id: 's_queue', machine: 'm', project: '/p', vendor: 'fake', transport: 'cli', cwd: '/p' });
  addQueuedPrompt(db, 's_queue', { id: 'q_1', text: 'one', createdAt: 1 });
  addQueuedPrompt(db, 's_queue', {
    id: 'q_2', text: 'two', createdAt: 2, images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
    context: [{ kind: 'file', path: 'src/main.ts' }],
    attachments: [{ name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }],
  });
  assert.equal(updateQueuedPrompt(db, 's_queue', 'q_1', 'updated'), true);
  assert.equal(setQueuedPromptError(db, 's_queue', 'q_1', 'Referenced file is gone'), true);
  assert.equal(moveQueuedPrompt(db, 's_queue', 'q_2', 0), true);
  db.close();

  db = openStore(path);
  assert.deepEqual(listQueuedPrompts(db, 's_queue'), [
    { id: 'q_2', text: 'two', createdAt: 2, images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }], context: [{ kind: 'file', path: 'src/main.ts' }], attachments: [{ name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }] },
    { id: 'q_1', text: 'updated', createdAt: 1, error: 'Referenced file is gone' },
  ]);
  assert.equal(updateQueuedPrompt(db, 's_queue', 'q_1', 'fixed'), true);
  assert.deepEqual(listQueuedPrompts(db, 's_queue').find(item => item.id === 'q_1'), { id: 'q_1', text: 'fixed', createdAt: 1 });
  assert.equal(removeQueuedPrompt(db, 's_queue', 'q_2'), true);
  assert.deepEqual(listQueuedPrompts(db, 's_queue').map(item => item.id), ['q_1']);
  db.close();
});

test('initial prompt context and attachments survive a store restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ormi-pending-prompt-')), 'store.db');
  let db = openStore(path);
  const data = { context: [{ kind: 'notes' }], attachments: [{ name: 'file.txt', mimeType: 'text/plain', data: 'aGVsbG8=' }] };
  setPendingPromptData(db, 's_pending', data);
  db.close();
  db = openStore(path);
  assert.deepEqual(getPendingPromptData(db, 's_pending'), data);
  db.close();
});

test('session and home drafts persist across a store restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ormi-drafts-')), 'store.db');
  let db = openStore(path);
  setDraft(db, 'home', 'new session draft');
  setDraft(db, 's_draft', 'reply draft');
  db.close();
  db = openStore(path);
  assert.equal(getDraft(db, 'home'), 'new session draft');
  assert.equal(getDraft(db, 's_draft'), 'reply draft');
  assert.equal(getDraft(db, 's_missing'), '');
  db.close();
});
