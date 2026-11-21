import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { expandPrompt, promptTitle } from '../src/prompt-context.ts';
import { PreviewInspector } from '../src/preview-inspector.ts';

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
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}));
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
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}));
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
    rmSync(worktree, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
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
    rmSync(nested, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  });
  const excludePath = join(repo, '.git/info/exclude');
  const excludeBefore = readFileSync(excludePath, 'utf8');
  const root = { cwd: nested, session: 's_nested', notesDir: join(nested, 'notes'), terminalOutput: () => undefined };
  expandPrompt(root, { text: 'read this', attachments: [{ name: 'nested.txt', mimeType: 'text/plain', data: Buffer.from('nested').toString('base64') }] });
  assert.equal(readFileSync(excludePath, 'utf8'), excludeBefore);
});

test('element and console contexts expand with details for the agent', () => {
  const cwd = makeRepo();
  const inspector = new PreviewInspector();
  try {
    inspector.report('s_context', 41000, { path: '/admin', entries: [{
      kind: 'network', level: 'error', message: 'HTTP 500', method: 'GET', url: '/api', status: 500,
      requestBody: '{"x":1}', responseBody: 'failed',
    }] });
    const consoleId = inspector.list('s_context').entries[0].id;
    inspector.report('s_context', 41000, { path: '/admin', entries: Array.from({ length: 12 }, (_, index) => ({
      kind: 'error', level: index === 10 ? 'warn' : 'error', message: `latest-${index}`,
    })) });
    const root = {
      cwd, session: 's_context', notesDir: join(cwd, 'notes'), terminalOutput: () => undefined,
      previewEntries: (session, ids) => inspector.forPrompt(session, ids),
    };
    const result = expandPrompt({
      ...root, previewEntries: (_session, ids) => inspector.forPrompt(_session, ids),
    }, { text: 'fix', context: [
      { kind: 'element', element: { url: 'http://web.localhost/admin', selector: '#save', html: '<button id="save">Save</button>', text: 'Save', styles: { color: 'red' }, rect: { x: 1, y: 2, width: 3, height: 4 }, component: 'SaveButton', source: 'src/App.tsx:4:2', comment: 'Make this primary', index: 2 } },
      { kind: 'console', console: { ids: [consoleId] } },
    ] });
    assert.match(result.text, /Element #2 on http:\/\/web\.localhost\/admin/);
    assert.match(result.text, /Selector: #save/);
    assert.match(result.text, /SaveButton \(src\/App\.tsx:4:2\)/);
    assert.match(result.text, /Comment: Make this primary/);
    assert.match(result.text, /Preview console:[\s\S]*HTTP 500[\s\S]*Request body:[\s\S]*Response body:/);
    const latest = expandPrompt(root, { text: 'fix latest', context: [{ kind: 'console', console: { ids: [] } }] });
    assert.match(latest.text, /latest-11/);
    assert.doesNotMatch(latest.text, /latest-0/);
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('a file-line comment titles an untitled session by the comment, not its file header', () => {
  const comment = 'About `cool things.txt` line 1:\n\n```text\nest file.\n```\n\nchange this to testing file';
  assert.equal(promptTitle(comment), 'change this to testing file');
  assert.equal(promptTitle('About `a.ts` lines 2–4:\n\n```typescript\n\n```\n\n  fix it\nplease'), 'fix it');
  assert.equal(promptTitle('About the weather today\nmore'), 'About the weather today');
  assert.equal(promptTitle(`  ${'x'.repeat(80)}`), `${'x'.repeat(57)}…`);
  assert.equal(promptTitle('\n  \n'), '');
});
