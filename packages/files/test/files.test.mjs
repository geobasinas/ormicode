import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FileError, fileBlame, fileHistory, listFiles, normalizePath, prepareWrite, readFile, resolvePath, searchContent, searchNames, writeFile } from '../src/index.ts';

const temp = prefix => mkdtempSync(join(tmpdir(), prefix));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const makeRepo = () => {
  const root = temp('ormicode-files-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'File Test');
  git(root, 'config', 'user.email', 'files@example.test');
  return root;
};
const commit = (root, ...args) => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', ...args);
  return git(root, 'rev-parse', 'HEAD');
};
const put = (root, path, content) => {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
};
const fileCode = code => error => error instanceof FileError && error.code === code;

test('path normalization rejects escapes, absolute paths, NUL, .git and external symlinks', t => {
  const root = temp('ormicode-file-path-');
  const outside = temp('ormicode-file-outside-');
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  symlinkSync(outside, join(root, 'escape'), 'dir');
  assert.equal(normalizePath('src\\main.ts'), 'src/main.ts');
  assert.throws(() => resolvePath(root, '../secret.txt'), fileCode('file.outside'));
  assert.throws(() => resolvePath(root, join(root, 'secret.txt')), fileCode('file.outside'));
  assert.throws(() => resolvePath(root, 'bad\0name'), fileCode('file.outside'));
  assert.throws(() => resolvePath(root, '.git/config'), fileCode('file.outside'));
  assert.throws(() => resolvePath(root, 'escape/secret.txt'), fileCode('file.outside'));
  assert.throws(() => resolvePath(root, 'missing.txt'), fileCode('file.not_found'));
});

test('file.list reports porcelain status, directory aggregation and deleted entries', t => {
  const root = makeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'tracked.txt', 'before');
  put(root, 'src/changed.ts', 'before');
  put(root, '.gitignore', 'ignored.txt\nignored-dir/\n');
  put(root, 'deleted.txt', 'tracked');
  commit(root, '-m', 'initial');
  put(root, 'tracked.txt', 'after');
  put(root, 'src/changed.ts', 'after');
  put(root, 'new.txt', 'new');
  put(root, 'new-dir/file.txt', 'new');
  put(root, 'ignored.txt', 'ignored');
  put(root, 'ignored-dir/file.txt', 'ignored');
  unlinkSync(join(root, 'deleted.txt'));

  const listed = listFiles(root);
  const byPath = new Map(listed.entries.map(entry => [entry.path, entry]));
  assert.equal(byPath.get('tracked.txt')?.git, 'modified');
  assert.equal(byPath.get('new.txt')?.git, 'untracked');
  assert.equal(byPath.get('ignored.txt')?.git, 'ignored');
  assert.equal(byPath.get('src')?.git, 'modified');
  assert.equal(byPath.get('new-dir')?.git, 'untracked');
  assert.equal(byPath.get('ignored-dir')?.git, 'ignored');
  assert.deepEqual(byPath.get('deleted.txt'), { name: 'deleted.txt', path: 'deleted.txt', kind: 'file', size: 0, mtime: 0, git: 'deleted' });
  assert.equal(byPath.has('.git'), false);
  assert.equal(typeof listed.root, 'string');
  assert.equal(listed.path, '');
  assert.equal(typeof listed.free === 'number' || listed.free === null, true);
  assert.equal(listFiles(root, 'src').entries[0]?.git, 'modified');
});

test('non-Git listing has no git fields', t => {
  const root = temp('ormicode-files-plain-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'plain.txt', 'plain');
  const result = listFiles(root);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.path, 'plain.txt');
  assert.equal(Object.hasOwn(result.entries[0], 'git'), false);
});

test('file.read handles text limits, binaries, image base64 and Git refs', async t => {
  const root = makeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'note.txt', 'current text');
  commit(root, '-m', 'commit note');
  put(root, 'note.txt', 'working text');
  const current = await readFile(root, 'note.txt');
  assert.equal(current.content, 'working text');
  assert.equal(current.binary, false);
  assert.equal(current.encoding, 'utf8');

  const big = 'x'.repeat(2 * 1024 * 1024 + 3);
  put(root, 'large.txt', big);
  const tooLarge = await readFile(root, 'large.txt');
  assert.equal(tooLarge.tooLarge, true);
  assert.equal(tooLarge.content, null);
  assert.equal((await readFile(root, 'large.txt', undefined, true)).content.length, big.length);
  put(root, 'hard-cap.txt', 'x'.repeat(10 * 1024 * 1024 + 1));
  assert.equal((await readFile(root, 'hard-cap.txt', undefined, true)).tooLarge, true);

  put(root, 'binary.dat', Buffer.from([0, 1, 2, 3]));
  const binary = await readFile(root, 'binary.dat');
  assert.equal(binary.binary, true);
  assert.equal(binary.content, null);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  put(root, 'tiny.png', png);
  const image = await readFile(root, 'tiny.png');
  assert.equal(image.binary, true);
  assert.equal(image.mime, 'image/png');
  assert.equal(image.encoding, 'base64');
  assert.equal(image.content, png.toString('base64'));

  unlinkSync(join(root, 'note.txt'));
  const historical = await readFile(root, 'note.txt', 'HEAD');
  assert.equal(historical.content, 'current text');
  assert.equal(historical.mtime, null);
  put(root, 'new.txt', 'not committed');
  await assert.rejects(readFile(root, 'new.txt', 'HEAD'), fileCode('file.not_found'));
});

test('file.write is atomic, preserves mode, checks mtime and refuses binary files', t => {
  const root = temp('ormicode-files-write-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = put(root, 'existing.txt', 'old');
  chmodSync(file, 0o640);
  const baseMtime = Math.round(statSync(file).mtimeMs);
  const target = prepareWrite(root, 'existing.txt', 'new', baseMtime);
  const saved = writeFile(target, 'new');
  assert.equal(saved.size, 3);
  assert.equal(statSync(file).mode & 0o777, process.platform === 'win32' ? 0o666 : 0o640);
  assert.equal(readdirSync(root).some(name => name.startsWith('.ormicode-')), false);
  assert.throws(() => prepareWrite(root, 'existing.txt', 'stale', baseMtime - 2), fileCode('file.conflict'));
  put(root, 'binary.bin', Buffer.from([0, 0, 1]));
  assert.throws(() => prepareWrite(root, 'binary.bin', 'text'), fileCode('file.binary'));
  const created = writeFile(prepareWrite(root, 'new/child.txt', 'created'), 'created');
  assert.equal(created.path, 'new/child.txt');
  assert.equal(existsSync(join(root, 'new', 'child.txt')), true);
});

test('file.search ranks names and returns content ranges, regex, no-match and truncation', async t => {
  const root = makeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'src/server.ts', 'é😀 target\nneedle123\n');
  put(root, 'src/serving.ts', 'unrelated\n');
  put(root, 'src/util.ts', 'target elsewhere\n');
  const names = searchNames(root, 'server');
  assert.equal(names.files[0]?.path, 'src/server.ts');
  assert.equal(names.truncated, false);

  const content = await searchContent(root, 'target');
  const unicode = content.matches.find(match => match.path === 'src/server.ts');
  assert.deepEqual(unicode?.ranges[0], [4, 10]);
  assert.equal(unicode?.text, 'é😀 target');
  const regex = await searchContent(root, '^needle\\d+$', true);
  assert.equal(regex.matches.some(match => match.text === 'needle123'), true);
  await assert.rejects(searchContent(root, '[', true), fileCode('file.bad_query'));
  assert.deepEqual((await searchContent(root, 'nothing-to-match')).matches, []);
  put(root, 'src/hits.txt', 'hit\nhit\nhit\n');
  const limited = await searchContent(root, 'hit', false, 1);
  assert.equal(limited.matches.length, 1);
  assert.equal(limited.truncated, true);
});

test('file.blame includes commit trailers and an uncommitted hunk', t => {
  const root = makeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'note.txt', 'first\nsecond\n');
  const first = commit(root, '-m', 'first commit', '-m', 'Ormi-Session: s_example');
  put(root, 'note.txt', 'first\nchanged\nthird\n');
  const second = commit(root, '-m', 'second commit');
  put(root, 'note.txt', 'first\nchanged\nthird\nuncommitted\n');
  const result = fileBlame(root, 'note.txt');
  assert.equal(result.commits[first]?.session, 's_example');
  assert.equal(result.commits[first]?.author, 'File Test');
  assert.equal(result.commits[second]?.summary, 'second commit');
  const uncommitted = '0'.repeat(40);
  assert.equal(result.commits[uncommitted]?.author, 'Not committed yet');
  assert.equal(result.hunks.some(hunk => hunk.sha === uncommitted && hunk.start === 4), true);
});

test('file.history follows a rename and Git methods reject non-repositories', t => {
  const root = makeRepo();
  const plain = temp('ormicode-files-history-plain-');
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(plain, { recursive: true, force: true }); });
  put(root, 'old.txt', 'one\ntwo\nthree\n');
  commit(root, '-m', 'create file');
  put(root, 'old.txt', 'one\ntwo\nthree\nfour\n');
  commit(root, '-m', 'edit file');
  git(root, 'mv', 'old.txt', 'new.txt');
  commit(root, '-m', 'rename file');
  const history = fileHistory(root, 'new.txt');
  assert.equal(history.total, 3);
  assert.equal(history.commits.length, 3);
  assert.equal(history.commits.some(item => item.subject === 'create file'), true);
  put(plain, 'plain.txt', 'text');
  assert.throws(() => fileBlame(plain, 'plain.txt'), fileCode('file.not_git'));
  assert.throws(() => fileHistory(plain, 'plain.txt'), fileCode('file.not_git'));
});
