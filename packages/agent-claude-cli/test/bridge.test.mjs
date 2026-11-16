import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startPermissionBridge } from '../src/bridge.ts';
import { PermissionBroker } from '../src/permissions.ts';

test('authenticated MCP tool forwards a decision and rejects unauthorized access', async () => {
  const events = [];
  const broker = new PermissionBroker((event) => events.push(event));
  const bridge = await startPermissionBridge(broker);
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    const denied = await fetch(bridge.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 401);
    const browserOrigin = await fetch(bridge.url, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${bridge.token}`, Origin: 'https://example.com' }, body: '{}' });
    assert.equal(browserOrigin.status, 405);
    const forgedHost = await new Promise((resolve, reject) => {
      const req = httpRequest(bridge.url, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(forgedHost, 403);
    const oversized = await fetch(bridge.url, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${bridge.token}` }, body: 'x'.repeat(256 * 1024 + 1) });
    assert.equal(oversized.status, 413);
    const transport = new StreamableHTTPClientTransport(new URL(bridge.url), { requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } } });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'approve'));
    const call = client.callTool({ name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'echo ok' }, tool_use_id: 'call-1' } });
    for (let i = 0; i < 100 && !events.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(events[0]?.kind, 'approval_request');
    assert.equal(events[0]?.toolUseId, 'call-1');
    broker.decide(events[0].request, 'allow');
    const result = await call;
    assert.deepEqual(JSON.parse(result.content[0].text), { behavior: 'allow', updatedInput: { command: 'echo ok' } });
  } finally {
    await client.close();
    await bridge.close();
  }
});

test('closing the bridge denies pending decisions', async () => {
  const broker = new PermissionBroker(() => {});
  const bridge = await startPermissionBridge(broker);
  const pending = broker.request('Write', {});
  await bridge.close();
  assert.equal((await pending).behavior, 'deny');
});

test('disconnecting a pending MCP call expires its approval', async () => {
  const events = [];
  const broker = new PermissionBroker((event) => events.push(event));
  const bridge = await startPermissionBridge(broker);
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url), { requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } } }));
    const controller = new AbortController();
    const call = client.callTool({ name: 'approve', arguments: { tool_name: 'Bash', input: {} } }, undefined, { signal: controller.signal });
    const rejection = assert.rejects(call);
    for (let i = 0; i < 100 && !events.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(events[0]?.kind, 'approval_request');
    controller.abort();
    await rejection;
    for (let i = 0; i < 100 && !events.some((event) => event.kind === 'interaction_expired'); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(events.some((event) => event.kind === 'interaction_expired'));
    assert.throws(() => broker.decide(events[0].request, 'allow'), /not pending/);
  } finally { await client.close(); await bridge.close(); }
});
