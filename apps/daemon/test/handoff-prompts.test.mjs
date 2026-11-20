import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createSession, setNote, addQueuedPrompt, listQueuedPrompts, setState } from '@ormicode/session-store';
import { transferHandoffPrompts } from '../src/handoff-prompts.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ormi-handoff-prompts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = openStore(':memory:'); t.after(() => db.close());
  for (const id of ['old', 'new']) {
    const cwd = join(root, id); mkdirSync(cwd); writeFileSync(join(cwd, 'common.txt'), id);
    createSession(db, { id, machine: 'm', project: root, cwd, vendor: 'fake', transport: 'cli' });
  }
  const notesDir = join(root, 'notes');
  for (const id of ['old', 'new']) setNote(notesDir, id, { title: id, body: `${id}-notes` }, () => id);
  const accesses = [], ctx = { db, notesDir, paused: new Set(['old']), heldPrompts: new Map(), record() {},
    terminals: { recentOutput(session) { accesses.push(session); return { terminal: 'terminal', output: `${session}-terminal` }; } },
    services: { previewEntries(session) { accesses.push(session); return [{ kind: 'console', level: 'error', message: `${session}-console`, path: '/page', port: 3000 }]; } },
  };
  return { root, db, ctx, accesses };
}

test('held and queued prompts snapshot source notes, terminal and console before transfer and retain metadata', async t => {
  const { db, ctx, accesses } = fixture(t);
  const prompt = { text: 'follow-up', images: [{ data: 'aGk=', mimeType: 'image/png' }], actor: 'auto',
    context: [{ kind: 'notes' }, { kind: 'terminal' }, { kind: 'console', console: { ids: ['entry'] } }, { kind: 'file', path: 'common.txt' }],
    attachments: [{ name: 'note.txt', mimeType: 'text/plain', data: 'aGk=' }],
  };
  ctx.heldPrompts.set('old', [prompt]);
  addQueuedPrompt(db, 'old', { id: 'queued', createdAt: 1, ...prompt });
  transferHandoffPrompts(ctx, 'old', 'new');
  const item = listQueuedPrompts(db, 'new')[0];
  assert.deepEqual(item.context, [{ kind: 'file', path: 'common.txt' }]);
  assert.deepEqual(item.images, prompt.images); assert.deepEqual(item.attachments, prompt.attachments); assert.equal(item.actor, 'auto');
  assert.ok(accesses.every(session => session === 'old'));
  setNote(ctx.notesDir, 'old', { title: 'old', body: 'changed-after-transfer' }, () => 'old');
  const sent = [];
  const delivery = createPromptDelivery({ ...ctx, lastPrompt: new Map(), previewEntries: () => { assert.fail('console must already be resolved'); },
    ensureWorker: async () => {}, toWorker: async (_session, _method, body) => { sent.push(body); setState(db, 'new', 'running'); return { type: 'res' }; },
  });
  ctx.paused.delete('new');
  for (let i = 0; i < 2; i++) { setState(db, 'new', 'idle'); assert.equal(await delivery.drainQueue('new'), true); }
  assert.equal(sent.length, 2);
  for (const wire of sent) {
    assert.match(wire.text, /old-notes/); assert.match(wire.text, /old-terminal/); assert.match(wire.text, /old-console/);
    assert.match(wire.text, /Referenced paths:[\s\S]*common\.txt/); assert.match(wire.text, /Attached files:/);
    assert.doesNotMatch(wire.text, /new-notes|new-terminal|new-console|changed-after-transfer/);
    assert.deepEqual(wire.images, prompt.images);
  }
});

test('context resolution failure rolls back all durable moves and leaves pause and held prompts owned by the source', t => {
  const { db, ctx } = fixture(t);
  const held = { text: 'held', context: [{ kind: 'notes' }] };
  ctx.heldPrompts.set('old', [held]);
  const items = [{ id: 'first', text: 'first', createdAt: 1, context: [{ kind: 'notes' }] },
    { id: 'bad', text: 'bad', createdAt: 2, context: [{ kind: 'console', console: { ids: ['bad'] } }] }];
  for (const item of items) addQueuedPrompt(db, 'old', item);
  ctx.services.previewEntries = () => { throw new Error('console unavailable'); };
  assert.throws(() => transferHandoffPrompts(ctx, 'old', 'new'), /console unavailable/);
  assert.deepEqual(listQueuedPrompts(db, 'old'), items); assert.deepEqual(listQueuedPrompts(db, 'new'), []);
  assert.deepEqual(ctx.heldPrompts.get('old'), [held]); assert.equal(ctx.heldPrompts.has('new'), false);
  assert.equal(ctx.paused.has('old'), true); assert.equal(ctx.paused.has('new'), false);
});

test('empty and self transfers do not resolve context or alter existing destination work', t => {
  const { db, ctx, accesses } = fixture(t);
  addQueuedPrompt(db, 'new', { id: 'existing', text: 'existing', createdAt: 1 });
  ctx.paused.clear();
  transferHandoffPrompts(ctx, 'old', 'old'); transferHandoffPrompts(ctx, 'old', 'new');
  assert.deepEqual(accesses, []); assert.equal(ctx.heldPrompts.size, 0); assert.equal(ctx.paused.size, 0);
  assert.deepEqual(listQueuedPrompts(db, 'new').map(item => item.text), ['existing']);
});
