import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession, createTeam, getTeam, ownedTeam, closeTeam, activeTeamCount, setSessionTeam, teamChildren,
  addTeamMessage, getTeamMessage, unreadTeamMessages, markTeamMessagesRead, settingValue, archiveSession } from '../src/index.ts';

test('team migration, membership, message inbox and lifecycle', () => {
  const db = openStore(':memory:');
  try {
    for (const id of ['parent', 'child']) createSession(db, { id, machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
    assert.equal(getTeam(db, 'missing'), undefined);
    assert.deepEqual(unreadTeamMessages(db, 'child'), []);
    createTeam(db, { id: 'team', parent: 'parent', project: '/repo' });
    assert.throws(() => createTeam(db, { id: 'duplicate', parent: 'parent', project: '/repo' }));
    setSessionTeam(db, 'child', 'team');
    assert.equal(teamChildren(db, 'team')[0].id, 'child');
    assert.equal(ownedTeam(db, 'parent').id, 'team');
    assert.equal(activeTeamCount(db), 1);
    const m = { id: 'message', team: 'team', from_session: 'parent', to_session: 'child', reply_to: null, body: 'hello', urgent: 0, created_at: 1 };
    addTeamMessage(db, m);
    assert.equal(getTeamMessage(db, 'message').body, 'hello');
    assert.equal(unreadTeamMessages(db, 'child').length, 1);
    markTeamMessagesRead(db, ['message']);
    assert.deepEqual(unreadTeamMessages(db, 'child'), []);
    assert.ok(getTeamMessage(db, 'message').read_at);
    assert.equal(settingValue(db, 'team.children'), undefined);
    db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('team.children', '2');
    assert.equal(settingValue(db, 'team.children'), 2);
    closeTeam(db, 'team');
    assert.equal(ownedTeam(db, 'parent'), undefined);
    assert.equal(activeTeamCount(db), 0);
    assert.ok(getTeam(db, 'team').closed_at);
  } finally { db.close(); }
});

test('active team limits exclude fully archived teams but retain teams with any live member', () => {
  const db = openStore(':memory:');
  try {
    assert.equal(activeTeamCount(db), 0);
    for (const id of ['parent', 'child', 'other']) createSession(db, { id, machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
    createTeam(db, { id: 'team', parent: 'parent', project: '/repo' });
    assert.equal(activeTeamCount(db), 1);
    setSessionTeam(db, 'child', 'team');
    archiveSession(db, 'parent');
    assert.equal(activeTeamCount(db), 1);
    archiveSession(db, 'child');
    assert.equal(activeTeamCount(db), 0);
    assert.equal(getTeam(db, 'team').closed_at, null);
    createTeam(db, { id: 'next', parent: 'other', project: '/repo' });
    assert.equal(activeTeamCount(db), 1);
    closeTeam(db, 'next');
    assert.equal(activeTeamCount(db), 0);
  } finally { db.close(); }
});
