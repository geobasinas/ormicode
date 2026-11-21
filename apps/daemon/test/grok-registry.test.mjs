import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrokCliAdapter } from '@ormicode/agent-grok-cli';
import { GrokAcpAdapter } from '@ormicode/agent-grok-acp';
import { agentList, createAdapter, resumable } from '../src/registry.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const registry = readFileSync(join(root, 'apps/daemon/src/registry.ts'), 'utf8');

test('grok/cli runs the headless agent-grok-cli package and grok/acp the ACP package', async () => {
  assert.match(registry, /'grok\/cli': \{ pkg: '@ormicode\/agent-grok-cli', cls: 'GrokCliAdapter' \}/);
  assert.match(registry, /'grok\/acp': \{ pkg: '@ormicode\/agent-grok-acp', cls: 'GrokAcpAdapter' \}/);
  const cli = await createAdapter('grok', 'cli', {});
  assert.ok(cli instanceof GrokCliAdapter);
  assert.equal(cli.transport, 'cli'); assert.equal(cli.capabilities.approvals, false); assert.equal(cli.capabilities.resume, true);
  const acp = await createAdapter('grok', 'acp', {});
  assert.ok(acp instanceof GrokAcpAdapter);
  assert.equal(acp.transport, 'acp');
});

test('pickers list Grok ACP and CLI as separate transports, both resumable', () => {
  assert.deepEqual(agentList().find(a => a.vendor === 'grok')?.transports, ['acp', 'cli']);
  assert.ok(resumable('grok', 'cli')); assert.ok(resumable('grok', 'acp'));
});

const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
for (const [from, to] of [['agent-grok-cli', 'agent-grok-acp'], ['agent-grok-acp', 'agent-grok-cli']]) test(`${from} does not mention ${to}`, () => {
  const pkg = join(root, 'packages', from);
  for (const file of [join(pkg, 'package.json'), ...files(join(pkg, 'src'))])
    assert.ok(!readFileSync(file, 'utf8').includes(to), `${file} mentions ${to}`);
});
