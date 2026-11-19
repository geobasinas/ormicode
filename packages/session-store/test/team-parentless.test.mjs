import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  openStore, createSession, createTeam, setSessionTeam, getSession, setChildrenParentless,
  addTeamMessage, addTeamUserMessage, getTeamUserMessage, hasTeamUserMessages, answerTeamUserMessage, unreadTeamMessages,
} from '../src/index.ts';

test('parentless flags and user-directed inbox requests persist independently of the parent inbox', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-team-parentless-store-')), path = join(dir, 'store.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = openStore(path);
  for (const id of ['parent', 'child', 'solo']) createSession(db, { id, parent: id === 'child' ? 'parent' : undefined, machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' }); setSessionTeam(db, 'child', 'team');
  assert.equal(getSession(db, 'child').parentless, 0);
  assert.deepEqual(setChildrenParentless(db, 'parent', true), ['child']);
  assert.deepEqual(setChildrenParentless(db, 'parent', true), []);
  assert.deepEqual(setChildrenParentless(db, 'missing', true), []);
  assert.equal(getSession(db, 'solo').parentless, 0);
  addTeamMessage(db, { id: 'message', team: 'team', from_session: 'child', to_session: 'parent', reply_to: null, body: 'finding', urgent: 0, created_at: 1 });
  addTeamUserMessage(db, 'request', 'message');
  assert.equal(hasTeamUserMessages(db, 'child'), true);
  assert.equal(hasTeamUserMessages(db, 'missing'), false);
  assert.equal(getTeamUserMessage(db, 'parent', 'request'), undefined);
  assert.throws(() => addTeamUserMessage(db, 'duplicate', 'message'));
  db.close(); db = openStore(path);
  try {
    assert.equal(getSession(db, 'child').parentless, 1);
    assert.deepEqual(unreadTeamMessages(db, 'parent'), []);
    assert.deepEqual(getTeamUserMessage(db, 'child', 'request'), { message: 'message', answered_at: null });
    answerTeamUserMessage(db, 'request');
    assert.ok(getTeamUserMessage(db, 'child', 'request').answered_at);
    assert.equal(hasTeamUserMessages(db, 'child'), false);
    assert.deepEqual(setChildrenParentless(db, 'parent', false), ['child']);
  } finally { db.close(); }
});

test('migration 0009 upgrades shipped teams data without changing messages or membership', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-team-upgrade-')), path = join(dir, 'store.db');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new Database(path);
  const migrations = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const file of readdirSync(migrations).sort().filter(file => /^000[1-8]-/.test(file))) old.exec(readFileSync(join(migrations, file), 'utf8'));
  old.pragma('user_version = 8');
  for (const id of ['parent', 'child']) createSession(old, { id, parent: id === 'child' ? 'parent' : undefined, machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
  createTeam(old, { id: 'team', parent: 'parent', project: '/repo' }); setSessionTeam(old, 'child', 'team');
  addTeamMessage(old, { id: 'message', team: 'team', from_session: 'child', to_session: 'parent', reply_to: null, body: 'preserved finding', urgent: 0, created_at: 1 });
  old.prepare('UPDATE sessions SET archived = 1 WHERE id = ?').run('parent');
  old.close();
  const db = openStore(path);
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 9);
    assert.equal(getSession(db, 'child').parentless, 1);
    assert.equal(getSession(db, 'child').team, 'team');
    assert.equal(getSession(db, 'child').parent, 'parent');
    assert.equal(unreadTeamMessages(db, 'parent')[0].body, 'preserved finding');
    assert.equal(hasTeamUserMessages(db, 'child'), false);
  } finally { db.close(); }
});
