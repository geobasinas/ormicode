import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MemoryKeyring, account } from '@ormicode/secrets';
import { SecretBroker } from '../src/secrets.ts';
import { workerEnvironment } from '../src/worker-env.ts';

test('stored secrets without declarations reach workers and tool children with project precedence and redaction', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-secret-env-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyring = new MemoryKeyring();
  const broker = new SecretBroker(join(dir, 'audit'), join(dir, 'names'), keyring);
  const project = join(dir, 'project');
  for (const [name, value, scope] of [['ORMI_TEST_SECRET', 'test-machine-value'], ['OVERRIDE', 'machine-value'], ['OVERRIDE', 'project-value', project], ['OTHER_PROJECT', 'other-value', '/other']]) {
    keyring.set(account(name, scope), value); broker.indexName(name, scope, true);
  }
  assert.deepEqual(broker.missing(project), []);
  const env = workerEnvironment({ id: 's', project, cwd: project, vendor: 'claude', transport: 'sdk' }, 41000, '/socket', broker, 'test-token');
  assert.equal(env.ORMI_TEST_SECRET, 'test-machine-value'); assert.equal(env.OVERRIDE, 'project-value');
  assert.equal(env.OTHER_PROJECT, undefined);
  const child = execFileSync(process.execPath, ['-e', 'process.stdout.write(process.env.ORMI_TEST_SECRET)'], { env, encoding: 'utf8' });
  assert.equal(child, 'test-machine-value');
  assert.match(JSON.stringify(broker.redact('s', { text: `${env.ORMI_TEST_SECRET} ${env.OVERRIDE}` })), /redacted:ORMI_TEST_SECRET/);
  assert.ok(!readFileSync(join(dir, 'audit'), 'utf8').includes('test-machine-value'));
  keyring.delete(account('ORMI_TEST_SECRET'));
  assert.equal(broker.envFor('next', project).ORMI_TEST_SECRET, undefined);
  assert.deepEqual(broker.envFor('empty', '/empty'), { OVERRIDE: 'machine-value' });
});
