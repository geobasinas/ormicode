import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparePr } from '../src/index.ts';
import { fixture, git } from './helpers.mjs';

test('PR preparation captures only a committed branch, explicit destination and base', t => {
  const f = fixture(); t.after(f.cleanup);
  assert.throws(() => preparePr(f.cwd, 'main'), /head and base must be different/);
  git(f.cwd, 'switch', '-c', 'feature');
  assert.throws(() => preparePr(f.cwd, null), /no recorded base/);
  const prepared = preparePr(f.cwd, 'origin/main');
  assert.deepEqual(prepared, { cwd: f.cwd, branch: 'feature', head: f.rootCommit, base: 'main', remote: f.origin });
  mkdirSync(join(f.cwd, '.ormi', 'worktrees', 'child'), { recursive: true });
  writeFileSync(join(f.cwd, '.ormi', 'worktrees', 'child', 'marker'), 'daemon-owned worktree');
  assert.deepEqual(preparePr(f.cwd, 'main'), prepared);
  writeFileSync(join(f.cwd, 'uncommitted.txt'), 'do not publish');
  assert.throws(() => preparePr(f.cwd, 'main'), /uncommitted changes/);
  git(f.cwd, 'add', 'uncommitted.txt'); git(f.cwd, 'commit', '-qm', 'committed');
  git(f.cwd, 'remote', 'set-url', 'origin', 'https://secret-user:secret-token@example.invalid/repo.git');
  assert.throws(() => preparePr(f.cwd, 'main'), /credential helper/);
  git(f.cwd, 'remote', 'remove', 'origin');
  assert.throws(() => preparePr(f.cwd, 'main'), /origin/);
  git(f.cwd, 'switch', '--detach');
  assert.throws(() => preparePr(f.cwd, 'main'), /detached HEAD/);
});
