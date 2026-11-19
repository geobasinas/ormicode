import test from 'node:test';
import assert from 'node:assert/strict';
import { McpCredentials } from '../src/mcp-auth.ts';

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
