import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, connect } from '../src/index.ts';
import { newId } from '@ormicode/protocol';

test('design review anchors, attribution, mentions, approval and version CAS', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-review-'));
  const project = join(dir, 'project'); mkdirSync(project);
  const otherProject = join(dir, 'other'); mkdirSync(otherProject);
  const daemon = await startDaemon({ socketPath: '127.0.0.1:0', storePath: join(dir, 'store.db') });
  const client = await connect(daemon.socketPath);
  const agent = await connect(daemon.socketPath, { v: 1, type: 'hello', role: 'client', proto: 1, device: 'mcp' });
  try {
    const start = async project => {
      const response = await client.request('session.start', { machine: newId('m'), project, vendor: 'fake', transport: 'cli', model: 'x', effort: 'x', mode: 'x', workspace: { kind: 'current' } });
      assert.equal(response.type, 'res', JSON.stringify(response));
      return response.body.session;
    };
    const peer = await start(project);
    assert.equal((await client.request('session.archive', { session: peer })).type, 'res');
    const session = await start(project);
    const outsider = await start(otherProject);
    const board = { session, slug: 'review' };
    const mentionable = await client.request('design.mentionable', { session });
    assert.deepEqual(new Set(mentionable.body.sessions.map(item => item.id)), new Set([session, peer]));
    assert.equal((await client.request('design.frameVersions', { ...board, frameId: 'missing' })).code, 'design.not_found');
    let doc = (await client.request('design.create', { ...board, name: 'Review' })).body.document;
    assert.deepEqual((await client.request('design.frameVersions', { ...board, frameId: 'missing' })).body.versions, []);
    const update = async (...operations) => {
      const response = await client.request('design.update', { ...board, expectedRevision: doc.revision, operations });
      assert.equal(response.type, 'res', JSON.stringify(response)); doc = response.body.document;
      return doc;
    };
    await update({ type: 'frame.add', name: 'Frame', x: 0, y: 0, width: 100, height: 100, html: 'one', styles: '' });
    const frameId = doc.frames[0].id;
    const firstRevision = doc.revision;
    await client.request('session.subscribe', { session: peer });
    const mentions = [];
    client.onFrame = frame => { if (frame.type === 'evt' && frame.body.kind === 'design_mention') mentions.push(frame); };
    await update(
      { type: 'comment.add', frameId: null, point: { x: 5, y: -8 }, text: 'Canvas', mentions: [peer, session] },
      { type: 'comment.add', frameId, point: { x: 1, y: 2 }, text: 'Frame point' },
      { type: 'comment.add', frameId, path: '0.1', element: 'button', text: 'Element' },
    );
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0].session, peer);
    assert.equal(mentions[0].body.from, session);
    assert.equal(mentions[0].body.excerpt, 'Canvas');
    const commentId = doc.comments[0].id;
    assert.equal(mentions[0].body.commentId, commentId);
    assert.equal(doc.comments[0].author.kind, 'user');
    assert.equal(doc.comments[0].author.session, session);
    assert.equal(doc.comments[0].session, session);
    assert.ok(doc.comments[0].createdAt > 0);
    assert.deepEqual(doc.comments[1].point, { x: 1, y: 2 });
    assert.equal(doc.comments[2].path, '0.1');
    await update({ type: 'comment.reply', commentId, text: 'Reply', mentions: [peer] }, { type: 'comment.resolve', commentId, resolved: true });
    assert.equal(mentions.length, 2);
    assert.equal(doc.comments[0].replies[0].author.session, session);
    assert.ok(doc.comments[0].replies[0].createdAt > 0);
    assert.ok(doc.comments[0].resolvedAt > 0);
    assert.equal(doc.comments[0].resolvedBy.session, session);
    await update({ type: 'comment.resolve', commentId, resolved: false });
    assert.equal(doc.comments[0].resolvedAt, undefined);
    assert.equal(doc.comments[0].resolvedBy, undefined);
    for (const operation of [
      { type: 'comment.add', frameId, text: 'No', mentions: [outsider] },
      { type: 'comment.reply', commentId, text: 'No', mentions: [outsider] },
      { type: 'comment.reply', commentId: 'missing', text: 'No' },
      { type: 'comment.add', frameId: null, path: '0', text: 'No' },
    ]) assert.equal((await client.request('design.update', { ...board, expectedRevision: doc.revision, operations: [operation] })).code, 'design.invalid');
    assert.equal((await client.request('design.update', { ...board, expectedRevision: doc.revision, operations: [{ type: 'comment.add', frameId, text: 'Forge', author: { kind: 'user', session } }] })).code, 'protocol.invalid_frame');
    for (const status of ['approved', 'draft']) assert.equal((await agent.request('design.update', { ...board, expectedRevision: doc.revision, operations: [{ type: 'frame.approval', frameId, status }] })).code, 'design.forbidden');
    await update({ type: 'frame.approval', frameId, status: 'approved' });
    const approval = doc.frames[0].approval;
    const approvedRevision = doc.revision;
    assert.equal(approval.status, 'approved'); assert.equal(approval.revision, doc.revision);
    assert.equal(approval.by.session, session); assert.match(approval.contentHash, /^[a-f0-9]{64}$/);
    await update({ type: 'frame.update', frameId, patch: { name: 'Renamed', x: 200, y: 80 } });
    assert.deepEqual(doc.frames[0].approval, approval);
    await update({ type: 'frame.duplicate', frameId });
    assert.equal(doc.frames[1].approval, undefined);
    await update({ type: 'frame.update', frameId, patch: { html: 'two' } });
    assert.equal(doc.frames[0].approval.status, 'needs_review');
    const versions = (await client.request('design.frameVersions', { ...board, frameId })).body.versions;
    assert.deepEqual(versions.map(item => item.html), ['two', 'one']);
    assert.equal(versions[0].current, true); assert.equal(versions[1].current, false);
    const stale = await client.request('design.update', { ...board, expectedRevision: 1, operations: [{ type: 'frame.restoreVersion', frameId, revision: firstRevision }] });
    assert.equal(stale.code, 'design.conflict');
    assert.equal((await client.request('design.update', { ...board, expectedRevision: doc.revision, operations: [{ type: 'frame.restoreVersion', frameId, revision: 1 }] })).code, 'design.not_found');
    await update({ type: 'frame.restoreVersion', frameId, revision: firstRevision });
    assert.equal(doc.frames[0].html, 'one'); assert.equal(doc.frames[0].name, 'Renamed'); assert.equal(doc.frames[0].x, 200);
    assert.equal(doc.frames[0].approval.status, 'needs_review');
    assert.match((await client.request('design.history', board)).body.history.at(-1).summary, /frame.restoreVersion/);
    assert.deepEqual((await client.request('design.frameVersions', { ...board, frameId })).body.versions.map(item => item.html), ['one', 'two', 'one']);
    await update({ type: 'frame.approval', frameId, status: 'draft' });
    const restore = await client.request('design.restore', { ...board, expectedRevision: doc.revision, targetRevision: approvedRevision });
    assert.equal(restore.type, 'res'); doc = restore.body.document;
    assert.equal(doc.frames[0].approval, undefined);
    await update({ type: 'frame.approval', frameId, status: 'approved' });
    const path = join(project, 'designs', 'review', 'workspace.json');
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    stored.document.frames[0].html = 'hand edit'; writeFileSync(path, JSON.stringify(stored));
    assert.equal((await client.request('design.get', board)).body.document.frames[0].approval.status, 'needs_review');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).document.frames[0].approval.status, 'approved');
    const large = { type: 'frame.add', name: 'Big', x: 0, y: 0, width: 100, height: 100, html: 'x'.repeat(24576), styles: '' };
    assert.equal((await client.request('design.update', { ...board, expectedRevision: doc.revision, operations: Array(5).fill(large) })).code, 'design.too_large');
    writeFileSync(path, 'x'.repeat(225 * 1024));
    assert.equal((await client.request('design.get', board)).code, 'design.too_large');
  } finally { agent.close(); client.close(); await daemon.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); }
});
