import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, git, commit as makeCommit } from './helpers.mjs';
import { branches, cherryPick, checkout, commit, createBranch, deleteBranch, merge, revert, stage, stash, unstage, NothingToCommit } from '../src/index.ts';

test('stage, unstage, commit, checkout, create and delete branches', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, 'tracked.txt'), 'staged\n');
    stage(f.cwd, ['tracked.txt']);
    unstage(f.cwd, ['tracked.txt']);
    stage(f.cwd);
    const result = commit(f.cwd, 'staged change');
    assert.match(result.sha, /^[0-9a-f]{40}$/);
    assert.throws(() => commit(f.cwd, 'empty'), NothingToCommit);
    createBranch(f.cwd, 'feature/new');
    assert.equal(branches(f.cwd).current, 'feature/new');
    checkout(f.cwd, 'main');
    deleteBranch(f.cwd, 'feature/new');
    assert.equal(branches(f.cwd).local.some(branch => branch.name === 'feature/new'), false);
    writeFileSync(join(f.cwd, 'tracked.txt'), 'dirty\n');
    assert.throws(() => checkout(f.cwd, 'main'), /uncommitted changes/);
  } finally { f.cleanup(); }
});

test('merge conflict returns file state and abort clears the merge', () => {
  const f = fixture();
  try {
    createBranch(f.cwd, 'side');
    writeFileSync(join(f.cwd, 'tracked.txt'), 'side\n');
    const side = makeCommit(f.cwd, 'side edit');
    checkout(f.cwd, 'main');
    writeFileSync(join(f.cwd, 'tracked.txt'), 'main\n');
    makeCommit(f.cwd, 'main edit');
    const result = merge(f.cwd, side);
    assert.equal(result.state, 'conflict');
    assert.deepEqual(result.conflict.files, ['tracked.txt']);
    assert.equal(merge(f.cwd, side, false, true).state, 'done');
  } finally { f.cleanup(); }
});

test('cherry-pick and revert apply single-parent commits', () => {
  const f = fixture();
  try {
    createBranch(f.cwd, 'change');
    writeFileSync(join(f.cwd, 'tracked.txt'), 'picked\n');
    const picked = makeCommit(f.cwd, 'pick me');
    checkout(f.cwd, 'main');
    assert.equal(cherryPick(f.cwd, [picked]).state, 'done');
    assert.equal(revert(f.cwd, [picked]).state, 'done');
    assert.equal(existsSync(join(f.cwd, 'tracked.txt')), true);
    assert.equal(git(f.cwd, 'show', 'HEAD:tracked.txt'), 'base');
  } finally { f.cleanup(); }
});

test('stash push, list, show and pop preserve tracked and untracked files', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, 'tracked.txt'), 'changed\n');
    writeFileSync(join(f.cwd, 'new.txt'), 'untracked\n');
    const pushed = stash(f.cwd, { op: 'push', includeUntracked: true, message: 'save work' });
    assert.equal(pushed.stashes.length, 1);
    assert.equal(pushed.stashes[0].files, 2);
    assert.equal(stash(f.cwd, { op: 'list' }).stashes[0].message, 'save work');
    assert.equal(stash(f.cwd, { op: 'show' }).files.length, 2);
    assert.equal(existsSync(join(f.cwd, 'new.txt')), false);
    assert.equal(stash(f.cwd, { op: 'pop' }).stashes.length, 0);
    assert.equal(existsSync(join(f.cwd, 'new.txt')), true);
  } finally { f.cleanup(); }
});
