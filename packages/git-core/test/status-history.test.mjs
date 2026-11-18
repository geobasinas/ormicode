import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, git, commit } from './helpers.mjs';
import { branches, log, show, status } from '../src/index.ts';

test('status reports staged stats, worktree states and branch tracking', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, 'tracked.txt'), 'base\nstaged\n');
    git(f.cwd, 'add', 'tracked.txt');
    writeFileSync(join(f.cwd, 'tracked.txt'), 'base\nstaged\nunstaged\n');
    writeFileSync(join(f.cwd, 'new.txt'), 'untracked\n');
    const result = status(f.cwd, 'HEAD');
    assert.equal(result.branch, 'main');
    assert.equal(result.upstream, 'origin/main');
    assert.deepEqual(result.files.map(file => [file.path, file.status, file.staged, file.unstaged]), [
      ['tracked.txt', 'M', true, true], ['new.txt', '?', false, true],
    ]);
    assert.deepEqual(result.staged, { added: 1, removed: 0, files: 1 });
  } finally { f.cleanup(); }
});

test('log marks unpushed commits and reads Ormi-Session trailers; show includes root commit patch', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, 'change.txt'), 'change\n');
    const sha = commit(f.cwd, 'change\n\nOrmi-Session: s_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const history = log(f.cwd);
    assert.equal(history.total, 2);
    assert.equal(history.commits[0].sha, sha);
    assert.equal(history.commits[0].pushed, false);
    assert.equal(history.commits[0].session, 's_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    assert.equal(history.commits[1].pushed, true);
    const root = show(f.cwd, f.rootCommit);
    assert.equal(root.sha, f.rootCommit);
    assert.deepEqual(root.files.map(file => [file.path, file.status, file.added]), [['tracked.txt', 'A', 1]]);
    assert.match(root.patch, /\+base/);
  } finally { f.cleanup(); }
});

test('branches include ahead/behind tracking and gone upstreams', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, 'local.txt'), 'local\n');
    commit(f.cwd, 'local ahead');
    const clone = join(f.root, 'clone');
    git(f.root, 'clone', f.origin, clone);
    git(clone, 'config', 'user.name', 'Git Test');
    git(clone, 'config', 'user.email', 'git-test@example.com');
    writeFileSync(join(clone, 'remote.txt'), 'remote\n');
    commit(clone, 'remote ahead');
    git(clone, 'push');
    git(f.cwd, 'fetch', 'origin');
    const tracked = status(f.cwd, null);
    assert.equal(tracked.ahead, 1);
    assert.equal(tracked.behind, 1);

    git(f.cwd, 'switch', '-c', 'gone');
    git(f.cwd, 'push', '-u', 'origin', 'gone');
    git(f.cwd, 'switch', 'main');
    git(f.cwd, 'push', 'origin', '--delete', 'gone');
    git(f.cwd, 'fetch', '--prune');
    const listed = branches(f.cwd).local.find(branch => branch.name === 'gone');
    assert.equal(listed.gone, true);
    assert.equal(listed.upstream, 'origin/gone');
  } finally { f.cleanup(); }
});
