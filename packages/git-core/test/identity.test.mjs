import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, git } from './helpers.mjs';
import { commit, stage } from '../src/index.ts';

test('a missing effective Git identity returns actionable configuration instructions without losing staged changes', () => {
  const f = fixture();
  const keys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    writeFileSync(join(f.cwd, 'tracked.txt'), 'updated\n'); stage(f.cwd);
    for (const key of keys) process.env[key] = '';
    assert.throws(() => commit(f.cwd, 'edit'), /Set user.name\/user.email.*git config user.name.*git config user.email/);
    assert.equal(git(f.cwd, 'diff', '--cached', '--name-only'), 'tracked.txt');
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    f.cleanup();
  }
});
