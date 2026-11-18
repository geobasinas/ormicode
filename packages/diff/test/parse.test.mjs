import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePatch } from '../src/index.ts';

test('parsePatch reads modified, added, deleted, renamed and binary files', () => {
  const patch = [
    'diff --git a/a.txt b/a.txt', 'index 1..2 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -1,2 +1,2 @@', ' keep', '-old', '+new',
    'diff --git a/n.txt b/n.txt', 'new file mode 100644', '--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,2 @@', '+x', '+y',
    'diff --git a/d.txt b/d.txt', 'deleted file mode 100644', '--- a/d.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone',
    'diff --git a/old.ts b/new.ts', 'similarity index 100%', 'rename from old.ts', 'rename to new.ts',
    'diff --git a/i.png b/i.png', 'Binary files a/i.png and b/i.png differ', '',
  ].join('\n');
  const files = parsePatch(patch);
  assert.deepEqual(files.map(f => [f.path, f.status, f.added, f.removed, f.binary]), [
    ['a.txt', 'modified', 1, 1, false], ['n.txt', 'added', 2, 0, false], ['d.txt', 'deleted', 0, 1, false],
    ['new.ts', 'renamed', 0, 0, false], ['i.png', 'modified', 0, 0, true],
  ]);
  assert.equal(files[2].path, 'd.txt');
  assert.equal(files[3].oldPath, 'old.ts');
  assert.equal(files[0].hunks[0].newStart, 1);
});
