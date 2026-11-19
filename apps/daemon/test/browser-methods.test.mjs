import assert from 'node:assert/strict';
import test from 'node:test';
import { browserMethod } from '../src/browser-methods.ts';

test('screenshot browser actions journal the artifact id', async () => {
  const events = [];
  let reply;
  const ctx = {
    agentBrowser: { screenshot: async () => ({ url: 'http://preview.local/', title: 'fixture', artifact: 'bl_test', jpeg: 'AA==' }) },
    services: { previewConsole: () => ({ next: 0, entries: [] }) },
    record: (_session, kind, payload) => events.push({ kind, payload }),
  };
  const client = { device: 'mcp', link: { reply: (_id, body) => { reply = body; }, replyError: () => assert.fail('unexpected error') } };
  await browserMethod(ctx, client, 'req', 'browser.screenshot', { session: 's_test' });
  assert.equal(events[0].payload.artifact, 'bl_test');
  assert.equal(events[0].payload.actor, 'agent');
  assert.equal(reply.artifact, 'bl_test');
});
