import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, serve } from '../src/socket.ts';
import { waitFor } from '../src/mcp-wait.ts';

for (const lateReply of [false, true]) test(`MCP timeout removes server subscription with ${lateReply ? 'dropped late' : 'no'} reply`, { timeout: 3000 }, async t => {
  const subscriptions = new Set();
  let serverLink, subscribeId, unsubscribes = 0;
  let cleaned;
  const cleanup = new Promise(resolve => { cleaned = resolve; });
  const server = await serve('127.0.0.1:0', link => {
    serverLink = link;
    link.onFrame = frame => {
      if (frame.method === 'session.subscribe') {
        subscriptions.add(frame.body.session);
        subscribeId = frame.id;
      } else if (frame.method === 'session.unsubscribe') {
        assert.deepEqual(frame.body, { session: 'child' });
        subscriptions.delete(frame.body.session); unsubscribes++;
        link.reply(frame.id, { unsubscribed: true }); cleaned();
      } else link.reply(frame.id, {});
    };
  });
  const link = await connect(`127.0.0.1:${server.address().port}`);
  t.after(() => { link.close(); serverLink.close(); server.close(); });
  const frames = [], previous = frame => frames.push(frame);
  link.onFrame = previous;
  assert.deepEqual(JSON.parse(await waitFor(link, 'child', 'idle', 40, { session: 'parent', token: 'test' })), { timedOut: true });
  await cleanup;
  assert.equal(subscriptions.size, 0);
  if (lateReply) serverLink.reply(subscribeId, { subscribed: true });
  await link.request('daemon.status', {}, 1000);
  assert.equal(link.onFrame, previous);
  assert.equal(unsubscribes, 1);
  if (lateReply) assert.equal(frames.some(frame => frame.id === subscribeId), true, 'late response was discarded by Link.request, not delivered to setup');
});
