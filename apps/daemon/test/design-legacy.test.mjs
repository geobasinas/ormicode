import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@ormicode/protocol';
import { getDesign, updateDesign } from '../src/design-store.ts';

test('boards written before the expanded editor retain their frames, feedback, and restore points', () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-design-legacy-'));
  const session = newId('s');
  const frame = { id: 'phone', name: 'Phone', x: 15, y: 25, width: 390, height: 844, html: '<p>Welcome</p>', styles: 'p { color: black }' };
  const first = { version: 1, name: 'Launch', revision: 1, frames: [frame], workingFrameId: null, comments: [] };
  const comment = { id: 'note', frameId: 'phone', element: 'p', text: 'Try a shorter heading', resolved: false, session, createdAt: 1 };
  const current = { ...first, revision: 2, workingFrameId: 'phone', comments: [comment] };
  const directory = join(root, 'designs', 'legacy');
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'workspace.json'), JSON.stringify({
      document: current,
      history: [{ revision: 1, at: 1, summary: 'Add feedback', document: first }],
    }));
    const stored = getDesign(root, 'legacy');
    assert.equal(stored.document.frames[0].html, frame.html);
    assert.equal(stored.document.comments[0].text, comment.text);
    assert.equal(stored.document.workingFrameId, frame.id);
    const changed = updateDesign(root, 'legacy', 2, [{ type: 'frame.update', frameId: frame.id, patch: { name: 'Updated' } }], session);
    assert.equal(changed.document.frames[0].name, 'Updated');
    assert.equal(changed.document.comments[0].id, comment.id);
    const restored = updateDesign(root, 'legacy', 3, 1, session);
    assert.equal(restored.document.revision, 4);
    assert.equal(restored.document.frames[0].name, frame.name);
    assert.equal(restored.document.frames[0].styles, frame.styles);
    assert.deepEqual(restored.document.comments, []);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});
