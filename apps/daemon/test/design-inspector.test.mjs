import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESIGN_TOKEN_LIMIT, newId } from '@ormicode/protocol';
import { createDesign, getDesign, updateDesign } from '../src/design-store.ts';

test('token and markup updates share the board CAS, persistence, and restore history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-design-token-'));
  try {
    const session = newId('s');
    const request = (revision, change) => updateDesign(dir, 'home', revision, change, session);
    const create = createDesign(dir, 'home', 'Home');
    assert.equal(create.document.tokens, undefined);
    const frame = { type: 'frame.add', name: 'Main', x: 0, y: 0, width: 390, height: 844, html: '<p>Home</p>', styles: '' };
    const { id: frameId } = request(1, [frame]).document.frames[0];
    const token = { name: 'brand', kind: 'color', value: '#123456' };
    const operation = { type: 'token.set', token };
    const html = '<p style="color: var(--ormi-design-brand);">Home</p>';
    assert.throws(() => request(2, [operation, { type: 'frame.update', frameId: 'missing', patch: { html } }]), { code: 'design.invalid' });
    assert.equal(getDesign(dir, 'home').document.tokens, undefined);
    const updated = request(2, [operation, { type: 'frame.update', frameId, patch: { html } }]);
    assert.equal(getDesign(dir, 'home').document.frames[0].html, html);
    assert.deepEqual(getDesign(dir, 'home').document.tokens, [token]);
    assert.equal(updated.history.at(-1).document.tokens, undefined);
    assert.throws(() => request(2, [operation]), { code: 'design.conflict' });
    assert.throws(() => request(3, [{ ...operation, token: { ...token, kind: 'spacing', value: '8px' } }]), { code: 'design.invalid' });
    const newValue = { ...token, value: '#abcdef' };
    assert.deepEqual(request(3, [{ ...operation, token: newValue }]).document.tokens, [newValue]);
    assert.deepEqual(request(4, 3).document.tokens, [token]);
    const restored = request(5, 2).document;
    assert.equal(restored.tokens, undefined);
    assert.equal(restored.frames[0].html, frame.html);
    const full = Array.from({ length: DESIGN_TOKEN_LIMIT }, (_, i) => ({ ...operation, token: { ...token, name: 'color-' + i } }));
    request(6, full.slice(0, 16));
    assert.equal(request(7, full.slice(16)).document.tokens.length, DESIGN_TOKEN_LIMIT);
    assert.throws(() => request(8, [operation]), { code: 'design.invalid' });
    assert.equal(getDesign(dir, 'home').document.revision, 8);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
