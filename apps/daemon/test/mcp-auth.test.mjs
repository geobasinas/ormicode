import test from 'node:test';
import assert from 'node:assert/strict';
import { McpCredentials, authorizeMcp } from '../src/mcp-auth.ts';
import { openStore, createSession } from '@ormicode/session-store';

test('design MCP requests are allowed only for the authenticated owning session', t => {
  const db = openStore(':memory:');
  t.after(() => db.close());
  for (const id of ['self', 'other']) createSession(db, { id, machine: 'local', project: '/repo', vendor: 'fake', transport: 'cli', cwd: '/repo' });
  const mcpCredentials = new McpCredentials();
  const proof = { session: 'self', token: mcpCredentials.issue('self') };
  const ctx = { db, mcpCredentials };
  for (const method of ['design.list', 'design.get', 'design.create', 'design.update', 'design.frameVersions', 'design.mentionable', 'design.history', 'design.activity', 'design.restore']) {
    assert.equal(authorizeMcp(ctx, method, { session: 'self' }, proof), undefined);
    assert.equal(authorizeMcp(ctx, method, { session: 'other' }, proof), 'mcp.forbidden');
    assert.equal(authorizeMcp(ctx, method, {}, proof), 'mcp.forbidden');
    assert.equal(authorizeMcp(ctx, method, { session: 'self' }, { ...proof, token: '0'.repeat(64) }), 'mcp.unauthorized');
  }
});

test('MCP credentials are session-bound, rotate on issue and expire on revoke', () => {
  const credentials = new McpCredentials();
  for (const proof of [undefined, null, '', {}, { session: 'a' }, { session: 'a', token: 42 }, { session: 'a', token: '0'.repeat(64) }])
    assert.equal(credentials.verify(proof), false);
  const first = credentials.issue('a');
  const other = credentials.issue('b');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(credentials.verify({ session: 'a', token: first }), true);
  assert.equal(credentials.verify({ session: 'b', token: first }), false);
  const next = credentials.issue('a');
  assert.notEqual(first, next);
  assert.equal(credentials.verify({ session: 'a', token: first }), false);
  credentials.revoke('a', first);
  assert.equal(credentials.verify({ session: 'a', token: next }), true);
  credentials.revoke('a', next);
  assert.equal(credentials.verify({ session: 'a', token: next }), false);
  assert.equal(credentials.verify({ session: 'b', token: other }), true);
  assert.deepEqual(credentials.redact({ nested: [`old ${first}`, { value: next }] }), {
    nested: ['old [REDACTED MCP TOKEN]', { value: '[REDACTED MCP TOKEN]' }],
  });
  credentials.clear();
  assert.equal(credentials.verify({ session: 'b', token: other }), false);
});
