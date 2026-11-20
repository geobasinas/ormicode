import assert from 'node:assert/strict';
import test from 'node:test';
import { newBoardIdentity } from '../src/features/design/create-board.ts';
import { createDesign, getDesign, listDesigns } from '../../../apps/daemon/src/design-store.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a name alone creates a persisted, selectable board in an empty workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'board-create-'));
  try {
    const identity = newBoardIdentity(' Testing ', []);
    assert.deepEqual(identity, { name: 'Testing', slug: 'testing' });
    const created = createDesign(root, identity.slug, identity.name);
    assert.equal(created.document.name, 'Testing');
    assert.equal(getDesign(root, identity.slug).document.name, 'Testing');
    assert.equal(listDesigns(root)[0].slug, identity.slug);
    assert.deepEqual(newBoardIdentity('Testing', listDesigns(root)), { name: 'Testing', slug: 'testing-2' });
    assert.throws(() => createDesign(root, identity.slug, identity.name), /already exists/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('empty names fail and names without ASCII letters still get a valid folder', () => {
  assert.throws(() => newBoardIdentity('  ', []), /Enter a board name/);
  assert.equal(newBoardIdentity('画板', []).slug, 'board');
  assert.equal(newBoardIdentity('Café', []).slug, 'cafe');
  assert.ok(newBoardIdentity('x'.repeat(120), [{ slug: 'x'.repeat(48) }]).slug.length <= 48);
});
