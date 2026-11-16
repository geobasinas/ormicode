import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLayout } from './check-rules.mjs';

test('layout check detects missing and invalid component directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'ormicode-layout-'));
  try {
    mkdirSync(join(root, 'apps', 'daemon'), { recursive: true });
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'packages', 'protocol'), 'not a directory');
    const errors = checkLayout(root, { apps: ['daemon', 'cli'], packages: ['protocol'] });
    assert.equal(errors.length, 2);
    assert.match(errors[0], /Missing .*cli/);
    assert.match(errors[1], /not a directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
