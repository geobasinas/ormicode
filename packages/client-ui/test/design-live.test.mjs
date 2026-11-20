import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsDesignRevision, designRefresh, sourceMatches } from '../src/features/design/design-live.ts';
import { designTaskContext } from '../src/features/design/design-agent-context.ts';

test('design invalidations coalesce per board and catch writes during an in-flight refresh', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const batches = [];
  const first = Promise.withResolvers();
  const updates = designRefresh(async revisions => {
    batches.push([...revisions]);
    if (batches.length === 1) await first.promise;
  });
  for (const [slug, revision] of [['home', 3], ['home', 2], ['other', 4], ['home', 5]]) updates.add({ slug, revision });
  t.mock.timers.tick(60);
  assert.deepEqual(batches, [[['home', 5], ['other', 4]]]);
  updates.add({ slug: 'home', revision: 6 });
  t.mock.timers.tick(60);
  assert.equal(batches.length, 1);
  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(60);
  assert.deepEqual(batches[1], [['home', 6]]);
  updates.add({ slug: 'home', revision: 7 });
  updates.close();
  t.mock.timers.tick(60);
  assert.equal(batches.length, 2);
});

test('replayed and superseded revisions cannot replace the current board', () => {
  const board = { revision: 3 };
  assert.equal(acceptsDesignRevision(board, { revision: 3 }, true), false);
  assert.equal(acceptsDesignRevision(board, { revision: 2 }, true), false);
  assert.equal(acceptsDesignRevision(board, { revision: 4 }, true), true);
  assert.equal(acceptsDesignRevision(null, { revision: 4 }, false), false);
  assert.equal(acceptsDesignRevision(board, { revision: 4 }, false), false);
});

test('a draft survives unrelated revisions and detects changes to the underlying source or frame', () => {
  const base = { id: 'phone', html: '<p>Original</p>', styles: 'p {color: red}' };
  assert.equal(sourceMatches({ ...base, x: 123, name: 'Renamed' }, base), true);
  assert.equal(sourceMatches({ ...base, html: '<p>MCP</p>' }, base), false);
  assert.equal(sourceMatches({ ...base, styles: '' }, base), false);
  assert.equal(sourceMatches({ ...base, id: 'other' }, base), false);
  assert.equal(sourceMatches(undefined, base), false);
});

test('queued design prompts identify the board and selected frame without copying markup', () => {
  assert.equal(designTaskContext({ slug: 'home', name: 'Home', revision: 4, frame: { id: 'phone', name: 'Phone', html: '<p>Draft</p>' } }),
    'Design board: "Home" (slug home; revision 4 when this task was sent). Selected frame: "Phone" (id phone). Read the latest board with ormi_design_get before applying changes.');
});
