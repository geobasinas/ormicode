import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, getSession, listSessions, sessionsInStates, setState, setTitle, archiveSession, setNativeId,
  addDevice, getDeviceByHash, listDevices, renameDevice, revokeDevice, listNotes, setNote, deleteNote } from '../src/index.ts';

test('openStore applies migrations and is idempotent on reopen', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ormi-store-')), 'nested', 'store.db');
  const db = openStore(path);
  const version = db.pragma('user_version', { simple: true });
  assert.ok(version >= 1);
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
  const id = setNote(dir, 's_1', { title: 'Plan', body: '- one\n' }, () => 'n_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  assert.equal(id, 'n_01ARZ3NDEKTSV4RRFFQ69G5FAV');
  setNote(dir, 's_1', { id, title: 'Plan 2', body: 'two' }, () => 'unused');
  assert.deepEqual(listNotes(dir, 's_1').map(n => [n.id, n.title, n.body]), [[id, 'Plan 2', 'two']]);
  assert.deepEqual(listNotes(dir, 's_none'), []);
  assert.equal(deleteNote(dir, 's_1', id), true);
  assert.equal(deleteNote(dir, 's_1', id), false);
});
