import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { expandPrompt } from '../src/prompt-context.ts';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ormi-context-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.ts'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

test('prompt context includes safe paths, capped diff, and the last 200 terminal lines', t => {
  const cwd = makeRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'src/main.ts'), 'changed\n'.repeat(20_000));
  const result = expandPrompt({
    cwd, session: 's_test', notesDir: join(cwd, 'notes'),
    terminalOutput: () => ({ terminal: 'term_1', output: Array.from({ length: 250 }, (_, i) => `line-${i}`).join('\n') }),
  }, { text: 'inspect', context: [{ kind: 'file', path: 'src/main.ts' }, { kind: 'folder', path: 'src' }, { kind: 'diff' }, { kind: 'terminal' }] });
  assert.match(result.text, /Referenced paths:[\s\S]*file: src\/main\.ts/);
  assert.match(result.text, /diff truncated at 64 KB/);
  assert.match(result.text, /line-50[\s\S]*line-249/);
  assert.doesNotMatch(result.text, /line-49\n/);
});

test('attachments are written under .ormi and capped at 10 MB each and 25 MB total', t => {
  const cwd = makeRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = { cwd, session: 's_test', notesDir: join(cwd, 'notes'), terminalOutput: () => undefined };
  const result = expandPrompt(root, { text: 'read this', attachments: [{ name: 'hello.txt', mimeType: 'text/plain', data: Buffer.from('hello').toString('base64') }] });
  assert.equal(readFileSync(join(cwd, result.attachments[0].path), 'utf8'), 'hello');
  expandPrompt(root, { text: 'read this again', attachments: [{ name: 'again.txt', mimeType: 'text/plain', data: Buffer.from('again').toString('base64') }] });
  const exclude = readFileSync(join(cwd, '.git/info/exclude'), 'utf8');
  assert.equal(exclude.split(/\r?\n/).filter(line => line.trim() === '/.ormi/').length, 1);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }), '');
  assert.throws(() => expandPrompt(root, {
    text: 'too big', attachments: [{ name: 'large.bin', mimeType: 'application/octet-stream', data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }],
  }), /10 MB/);
  const nineMb = Buffer.alloc(9 * 1024 * 1024).toString('base64');
  assert.throws(() => expandPrompt(root, {
    text: 'too many', attachments: [1, 2, 3].map(i => ({ name: `file-${i}`, mimeType: 'application/octet-stream', data: nineMb })),
  }), /25 MB/);
});

test('attachment exclusion resolves through git metadata in a linked worktree', t => {
  const cwd = makeRepo();
  const worktree = join(cwd, '..', `ormi-linked-${process.pid}-${Date.now()}`);
  t.after(() => {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
  execFileSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd, stdio: 'ignore' });
  const root = { cwd: worktree, session: 's_linked', notesDir: join(worktree, 'notes'), terminalOutput: () => undefined };
  expandPrompt(root, { text: 'read this', attachments: [{ name: 'linked.txt', mimeType: 'text/plain', data: Buffer.from('linked').toString('base64') }] });
  const gitPath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: worktree, encoding: 'utf8' }).trim();
  const excludePath = isAbsolute(gitPath) ? gitPath : resolve(worktree, gitPath);
  const exclude = readFileSync(excludePath, 'utf8');
  assert.equal(exclude.split(/\r?\n/).filter(line => line.trim() === '/.ormi/').length, 1);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' }), '');
});

test('attachments outside a repository do not modify another repository exclude', t => {
  const repo = makeRepo();
  const nested = mkdtempSync(join(tmpdir(), 'ormi-context-nonrepo-'));
  t.after(() => {
    rmSync(nested, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const excludePath = join(repo, '.git/info/exclude');
  const excludeBefore = readFileSync(excludePath, 'utf8');
  const root = { cwd: nested, session: 's_nested', notesDir: join(nested, 'notes'), terminalOutput: () => undefined };
  expandPrompt(root, { text: 'read this', attachments: [{ name: 'nested.txt', mimeType: 'text/plain', data: Buffer.from('nested').toString('base64') }] });
  assert.equal(readFileSync(excludePath, 'utf8'), excludeBefore);
});
