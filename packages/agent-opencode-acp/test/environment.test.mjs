import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionEnvironment } from '../src/environment.ts';

test('ACP forces permission requests while preserving non-permission configuration and environment', () => {
  const env = { PATH: '/bin', OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'vendor/model', permission: { '*': 'allow', edit: 'allow' } }) };
  const result = permissionEnvironment(env);
  assert.deepEqual(JSON.parse(result.OPENCODE_CONFIG_CONTENT), { model: 'vendor/model', permission: { '*': 'ask' } });
  assert.equal(result.PATH, '/bin'); assert.match(env.OPENCODE_CONFIG_CONTENT, /allow/);
  assert.deepEqual(JSON.parse(permissionEnvironment({}).OPENCODE_CONFIG_CONTENT), { permission: { '*': 'ask' } });
  for (const value of ['{', 'null', '[]']) assert.throws(() => permissionEnvironment({ OPENCODE_CONFIG_CONTENT: value }), /OPENCODE_CONFIG_CONTENT/);
});
