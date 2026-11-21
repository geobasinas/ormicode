import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('shared focus tokens use neutral borders, including auto-focused menu containers', () => {
  const css = source('index.css');
  assert.match(css, /--ring: var\(--line-card\);/);
  assert.match(css, /--focus-ring: var\(--line-card\);/);
  assert.doesNotMatch(css, /--(?:focus-)?ring: var\(--line-mint\)/);
});

test('both composers opt out of the global inner focus outline', () => {
  for (const file of ['NewSession', 'Composer']) {
    assert.match(source(`features/session/${file}.tsx`), /<textarea\s+className="ormi-composer-input"/);
  }
  assert.match(source('index.css'), /\.ormi-composer-input:focus-visible\s*\{[^}]*outline: none !important;[^}]*border: none !important;/);
});

const MINT = /(?:line|accent|tint)-mint|#7DDBA8|#1C7547|\b(?:green|emerald)-\d/i;
const walk = (dir, ext) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path, ext) : path.endsWith(ext) ? [path] : [];
});
const srcDir = fileURLToPath(new URL('../src', import.meta.url));

test('every ring token, including the sidebar ring, resolves to the neutral border', () => {
  const css = source('index.css');
  assert.match(css, /--sidebar-ring: var\(--line-card\);/);
  assert.match(css, /--color-ring: var\(--ring\);/);
  assert.match(css, /--color-sidebar-ring: var\(--sidebar-ring\);/);
  assert.match(css, /:focus-visible \{ outline: 1px solid var\(--focus-ring\) !important;/);
  for (const file of walk(srcDir, '.css')) {
    for (const [decl] of readFileSync(file, 'utf8').matchAll(/--[\w-]*ring[\w-]*:[^;]*;/g)) {
      assert.doesNotMatch(decl, MINT, `${file}: ${decl}`);
    }
  }
});

test('no focus, outline or ring style anywhere uses mint', () => {
  for (const file of walk(srcDir, '.css')) {
    for (const [rule] of readFileSync(file, 'utf8').matchAll(/[^{}]*:focus[^{]*\{[^}]*\}/g)) {
      assert.doesNotMatch(rule, MINT, `${file}: ${rule.trim()}`);
    }
  }
  for (const file of walk(srcDir, '.tsx')) {
    const text = readFileSync(file, 'utf8');
    for (const [cls] of text.matchAll(/(?:focus[\w-]*:|\bring-|\boutline-)[^\s"'`]*/g)) {
      assert.doesNotMatch(cls, MINT, `${file}: ${cls}`);
    }
    for (const [style] of text.matchAll(/outline(?:Color)?:\s*[^,}]*/g)) {
      assert.doesNotMatch(style, MINT, `${file}: ${style}`);
    }
  }
});

test('menu and popover containers carry no ring colour of their own', () => {
  for (const file of ['dropdown-menu', 'context-menu', 'menubar', 'popover', 'select', 'command', 'combobox', 'dialog']) {
    assert.doesNotMatch(source(`components/ui/${file}.tsx`), MINT);
  }
});
