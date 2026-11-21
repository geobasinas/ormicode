import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';
import { createSession } from '@ormicode/session-store';
import { createDesign, listDesigns } from '../src/design-store.ts';

test('design boards persist, use CAS, retain restore points and emit events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-design-'));
  const project = join(dir, 'project'); mkdirSync(project);
  const storePath = join(dir, 'store.db');
  let daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
  let client = await connect(daemon.socketPath);
  try {
    const started = await client.request('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
    assert.equal(started.type, 'res');
    const session = started.body.session;
    assert.equal((await client.request('session.subscribe', { session })).type, 'res');
    assert.deepEqual((await client.request('design.list', { session })).body.boards, []);
    const created = await client.request('design.create', { session, slug: 'home', name: 'Home' });
    assert.equal(created.type, 'res');
    assert.equal(created.body.document.revision, 1);
    assert.equal((await client.request('design.update', { session, slug: 'home', expectedRevision: 1, operations: [{ type: 'frame.update', frameId: 'missing', patch: { html: 'No' } }] })).code, 'design.invalid');
    assert.equal((await client.request('design.get', { session, slug: 'home' })).body.document.revision, 1);
    assert.equal((await client.request('design.list', { session })).body.boards[0].slug, 'home');
    const largeFrame = { type: 'frame.add', name: 'Large', x: 0, y: 0, width: 100, height: 100, html: 'x'.repeat(24576), styles: '' };
    assert.equal((await client.request('design.update', { session, slug: 'home', expectedRevision: 1, operations: Array.from({ length: 5 }, () => largeFrame) })).code, 'design.too_large');
    assert.equal((await client.request('design.update', { session, slug: 'home', expectedRevision: 1, operations: [{ ...largeFrame, width: 5000 }] })).code, 'protocol.invalid_frame');

    const gotEvent = new Promise(resolve => {
      const timer = setTimeout(() => resolve(undefined), 3000);
      client.onFrame = frame => { if (frame.type === 'evt' && frame.session === session && frame.body.kind === 'design_changed') { clearTimeout(timer); resolve(frame); } };
    });
    const first = await client.request('design.update', { session, slug: 'home', expectedRevision: 1, operations: [{ type: 'frame.add', name: 'Desktop', x: 0, y: 0, width: 1440, height: 900, html: '<main>Home</main>', styles: '' }] });
    assert.equal(first.type, 'res');
    assert.equal(first.body.document.revision, 2);
    assert.equal((await gotEvent)?.body.kind, 'design_changed');
    const frameId = first.body.document.frames[0].id;
    const stale = await client.request('design.update', { session, slug: 'home', expectedRevision: 1, operations: [{ type: 'board.rename', name: 'Stale' }] });
    assert.equal(stale.code, 'design.conflict');

    const concurrent = await Promise.all(['One', 'Two'].map(name => client.request('design.update', { session, slug: 'home', expectedRevision: 2, operations: [{ type: 'board.rename', name }] })));
    assert.deepEqual(concurrent.map(response => response.type).sort(), ['err', 'res']);
    assert.equal(concurrent.find(response => response.type === 'err').code, 'design.conflict');
    let current = await client.request('design.get', { session, slug: 'home' });
    const revisionBeforeRestore = current.body.document.revision;
    for (let i = 0; i < 21; i++) {
      current = await client.request('design.update', { session, slug: 'home', expectedRevision: current.body.document.revision, operations: [{ type: 'frame.update', frameId, patch: { x: i } }] });
      assert.equal(current.type, 'res', JSON.stringify(current));
    }
    const history = await client.request('design.history', { session, slug: 'home' });
    assert.equal(history.body.history.length, 20);
    const restored = await client.request('design.restore', { session, slug: 'home', expectedRevision: current.body.document.revision, targetRevision: history.body.history[0].revision });
    assert.equal(restored.type, 'res');
    assert.ok(restored.body.document.revision > current.body.document.revision);
    assert.equal((await client.request('design.get', { session, slug: 'home' })).body.document.frames[0].x, 0);
    assert.ok(revisionBeforeRestore < restored.body.document.revision);

    const pathError = await client.request('design.get', { session, slug: '../outside' });
    assert.equal(pathError.type, 'err');
    const missing = await client.request('design.list', { session: newId('s') });
    assert.equal(missing.code, 'session.not_found');

    const path = join(project, 'designs', 'home', 'workspace.json');
    client.close(); await daemon.close();
    daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath });
    client = await connect(daemon.socketPath);
    const afterRestart = await client.request('design.get', { session, slug: 'home' });
    assert.equal(afterRestart.type, 'res');
    assert.equal(afterRestart.body.document.revision, restored.body.document.revision);
    const original = readFileSync(path);
    writeFileSync(path, '{');
    assert.equal((await client.request('design.get', { session, slug: 'home' })).code, 'design.invalid');
    writeFileSync(path, '{}');
    assert.equal((await client.request('design.get', { session, slug: 'home' })).code, 'design.invalid');
    writeFileSync(path, 'x'.repeat(225 * 1024));
    assert.equal((await client.request('design.get', { session, slug: 'home' })).code, 'design.too_large');
    const outside = join(dir, 'outside-board'); mkdirSync(outside); writeFileSync(join(outside, 'workspace.json'), original);
    rmSync(path); symlinkSync(join(outside, 'workspace.json'), path);
    assert.equal((await client.request('design.get', { session, slug: 'home' })).code, 'design.outside');
    assert.equal((await client.request('design.update', { session, slug: 'home', expectedRevision: restored.body.document.revision, operations: [{ type: 'board.rename', name: 'No escape' }] })).code, 'design.outside');
    assert.deepEqual(readFileSync(join(outside, 'workspace.json')), original);
    symlinkSync(outside, join(project, 'designs', 'escape'), 'dir');
    assert.equal((await client.request('design.get', { session, slug: 'escape' })).code, 'design.outside');
  } finally {
    client.close(); await daemon.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('worktree sessions keep the project design canvas', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-design-canvas-'));
  const project = join(dir, 'project');
  const worktree = join(project, '.ormi', 'worktrees', 'task');
  const other = join(dir, 'other');
  mkdirSync(worktree, { recursive: true });
  mkdirSync(other);
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  const main = newId('s');
  const linked = newId('s');
  const foreign = newId('s');
  try {
    createDesign(worktree, 'local-only', 'Worktree only');
    for (const [id, cwd, projectPath] of [[main, project, project], [linked, worktree, project], [foreign, other, other]]) {
      createSession(daemon.db, { id, machine: newId('m'), project: projectPath, cwd, ...(cwd === worktree ? { worktree: cwd } : {}), vendor: 'fake', transport: 'cli' });
    }
    const created = await client.request('design.create', { session: main, slug: 'retest', name: 'Retest Board' });
    assert.equal(created.type, 'res');
    const frame = await client.request('design.update', {
      session: main, slug: 'retest', expectedRevision: 1,
      operations: [{ type: 'frame.add', name: 'Desktop', x: 0, y: 0, width: 1440, height: 900, html: '<main>Home</main>', styles: '' }],
    });
    assert.equal(frame.type, 'res');
    const listed = await client.request('design.list', { session: linked });
    assert.deepEqual(listed.body.boards.map(board => board.slug), ['retest']);
    assert.equal(listed.body.boards[0].name, 'Retest Board');
    assert.equal((await client.request('design.get', { session: linked, slug: 'retest' })).body.document.frames[0].name, 'Desktop');
    assert.equal(existsSync(join(project, 'designs', 'retest', 'workspace.json')), true);
    assert.equal(existsSync(join(worktree, 'designs', 'retest', 'workspace.json')), false);
    assert.deepEqual((await client.request('design.list', { session: foreign })).body.boards, []);
    const mentionable = await client.request('design.mentionable', { session: linked });
    assert.deepEqual(mentionable.body.sessions.map(item => item.id).sort(), [linked, main].sort());
    const changed = [];
    const both = new Promise(resolve => {
      const timer = setTimeout(() => resolve(changed), 3000);
      client.onFrame = event => {
        if (event.type !== 'evt' || event.body.kind !== 'design_changed') return;
        changed.push(event.session);
        if (changed.includes(main) && changed.includes(linked)) { clearTimeout(timer); resolve(changed); }
      };
    });
    await client.request('session.subscribe', { session: main });
    await client.request('session.subscribe', { session: linked });
    await client.request('session.subscribe', { session: foreign });
    const renamed = await client.request('design.update', { session: linked, slug: 'retest', expectedRevision: 2, operations: [{ type: 'board.rename', name: 'Shared' }] });
    assert.equal(renamed.type, 'res');
    await both;
    assert.equal(changed.includes(main), true);
    assert.equal(changed.includes(linked), true);
    assert.equal(changed.includes(foreign), false);
    assert.equal((await client.request('design.get', { session: main, slug: 'retest' })).body.document.name, 'Shared');
    assert.equal(existsSync(join(worktree, 'designs', 'retest', 'workspace.json')), false);
  } finally {
    client.close(); await daemon.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('workspace board count stays within the list response bound', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-design-count-'));
  try {
    assert.deepEqual(listDesigns(dir), []);
    for (let i = 0; i < 100; i++) createDesign(dir, `board-${i}`, 'Board');
    assert.equal(listDesigns(dir).length, 100);
    assert.throws(() => createDesign(dir, 'one-too-many', 'Board'), error => error.code === 'design.too_large');
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); }
});
