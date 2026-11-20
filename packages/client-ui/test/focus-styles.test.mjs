import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
