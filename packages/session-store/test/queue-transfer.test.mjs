import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, addQueuedPrompt, listQueuedPrompts, transferQueuedPrompts } from '../src/index.ts';

test('queue transfer preserves ordering, IDs and prompt metadata while appending to the recipient', t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const item = { id: 'first', text: 'follow up', createdAt: 1, images: [{ data: 'aGk=', mimeType: 'image/png' }], context: [{ kind: 'file', path: 'README.md' }], attachments: [{ name: 'note.txt', data: 'aGk=', mimeType: 'text/plain' }], actor: 'auto', error: 'retry after fixing context' };
  addQueuedPrompt(db, 'old', item);
  addQueuedPrompt(db, 'old', { id: 'second', text: 'later', createdAt: 0 });
  addQueuedPrompt(db, 'new', { id: 'existing', text: 'existing', createdAt: 2 });
  assert.equal(transferQueuedPrompts(db, 'old', 'old'), 0);
  assert.equal(transferQueuedPrompts(db, 'old', 'new'), 2);
  assert.deepEqual(listQueuedPrompts(db, 'old'), []);
  assert.deepEqual(listQueuedPrompts(db, 'new').slice(1), [item, { id: 'second', text: 'later', createdAt: 0 }]);
  assert.equal(transferQueuedPrompts(db, 'old', 'new'), 0);
});
