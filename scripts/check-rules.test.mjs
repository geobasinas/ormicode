import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLayout } from './check-rules.mjs';
import { checkAgentBoundaries } from './check-agent-boundaries.mjs';

test('layout check detects missing and invalid component directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'ormicode-layout-'));
  try {
    mkdirSync(join(root, 'apps', 'daemon'), { recursive: true });
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(join(root, 'packages', 'protocol'), 'not a directory');
    const errors = checkLayout(root, { apps: ['daemon', 'cli'], packages: ['protocol'] });
    assert.equal(errors.length, 2);
    assert.match(errors[0], /Missing .*cli/);
    assert.match(errors[1], /not a directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function agentTree(packages) {
  const root = mkdtempSync(join(tmpdir(), 'ormicode-agents-'));
  for (const [name, { deps = {}, files = {} }] of Object.entries(packages)) {
    const dir = join(root, 'packages', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@ormicode/${name}`, dependencies: deps }));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
  }
  return root;
}

test('agent boundary check passes adapters that import only agent-core, protocol and npm libs', () => {
  const root = agentTree({
    'agent-core': { deps: { '@ormicode/protocol': 'workspace:*' }, files: { 'src/index.ts': "import { x } from '@ormicode/protocol';\n" } },
    'agent-foo-sdk': {
      deps: { '@ormicode/agent-core': 'workspace:*', '@ormicode/protocol': 'workspace:*', '@vendor/foo-sdk': '1.0.0', zod: '4.0.0' },
      files: {
        'src/adapter.ts': "import type {\n  AgentAdapter,\n} from '@ormicode/agent-core';\nimport { z } from 'zod';\nimport { run } from '@vendor/foo-sdk';\nimport { map } from './map.js';\n",
        'test/adapter.test.mjs': "import { adapter } from '../src/adapter.ts';\nimport { fake } from '@ormicode/agent-foo-sdk/test';\n",
      },
    },
  });
  try {
    assert.deepEqual(checkAgentBoundaries(root, []), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent boundary check flags adapter-to-adapter imports, relative reaches and package.json deps', () => {
  const root = agentTree({
    'agent-core': { files: { 'src/index.ts': "export * from '@ormicode/agent-foo-sdk';\n" } },
    'agent-foo-sdk': { files: { 'src/index.ts': 'export {};\n' } },
    'agent-foo-cli': {
      deps: { '@ormicode/agent-foo-sdk': 'workspace:*' },
      files: {
        'src/adapter.ts': "import { x } from '@ormicode/agent-foo-sdk';\n",
        'scripts/probe.mjs': "const m = await import('../../agent-foo-sdk/src/index.ts');\n",
        'test/a.test.mjs': "import { y } from '../../agent-core/src/index.ts';\n",
      },
    },
  });
  try {
    const errors = checkAgentBoundaries(root, []);
    assert.equal(errors.length, 5, errors.join('\n'));
    assert.ok(errors.some((e) => /agent-core[\\/]src[\\/]index\.ts:1: agent-core must not import '@ormicode\/agent-foo-sdk'/.test(e)));
    assert.ok(errors.some((e) => /package\.json: dependencies must not include @ormicode\/agent-foo-sdk/.test(e)));
    assert.ok(errors.some((e) => /adapter\.ts:1: agent-foo-cli must not import/.test(e)));
    assert.ok(errors.some((e) => /probe\.mjs:1: relative import .* reaches into packages\/agent-foo-sdk/.test(e)));
    assert.ok(errors.some((e) => /a\.test\.mjs:1: relative import .* reaches into packages\/agent-core/.test(e)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('agent boundary allowlist permits named imports and reports stale entries', () => {
  const root = agentTree({
    'agent-foo-sdk': { files: { 'src/index.ts': 'export {};\n' } },
    'agent-foo-cli': {
      deps: { '@ormicode/agent-foo-sdk': 'workspace:*' },
      files: { 'src/adapter.ts': "import { x } from '@ormicode/agent-foo-sdk';\n" },
    },
  });
  try {
    assert.deepEqual(checkAgentBoundaries(root, [{ from: 'agent-foo-cli', to: 'agent-foo-sdk' }]), []);
    const errors = checkAgentBoundaries(root, [
      { from: 'agent-foo-cli', to: 'agent-foo-sdk' },
      { from: 'agent-foo-sdk', to: 'agent-foo-cli' },
    ]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Stale agent boundary allowlist entry agent-foo-sdk -> agent-foo-cli/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
