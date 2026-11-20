import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('native and document window titles use the product name', () => {
  assert.match(readFileSync(new URL('../apps/desktop/src/main/index.ts', import.meta.url), 'utf8'), /title: 'Ormicode'/);
  assert.match(readFileSync(new URL('../apps/desktop/src/renderer/index.html', import.meta.url), 'utf8'), /<title>Ormicode<\/title>/);
});
