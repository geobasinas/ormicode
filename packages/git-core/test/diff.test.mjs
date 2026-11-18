import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffStat, diffPatch, DiffStatCache } from '../src/index.ts';

test('diffStat counts tracked edits and untracked files against the base, ignoring .gitignore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-gitcore-'));
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]).toString().trim();
  git('init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n'); writeFileSync(join(dir, '.gitignore'), 'skip\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'a.txt'), 'one\nTWO\nthree\n');
  writeFileSync(join(dir, 'new.txt'), 'n\n'); writeFileSync(join(dir, 'skip'), 'ignored\n');
  assert.deepEqual(diffStat(dir, base), { files: 2, added: 3, removed: 1 });
  assert.deepEqual(diffPatch(dir, base).files.map(f => [f.path, f.status]), [['a.txt', 'modified'], ['new.txt', 'added']]);
  assert.equal(git('status', '--porcelain').includes('?? new.txt'), true);
  const cache = new DiffStatCache(1000);
  assert.equal(cache.get(dir, base, 0).added, 3);
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  assert.equal(cache.get(dir, base, 500).files, 2);
  assert.equal(cache.get(dir, base, 2000).files, 3);
  assert.equal(cache.get(join(dir, 'nope'), base), null);
});
