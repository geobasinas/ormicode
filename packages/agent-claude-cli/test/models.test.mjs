import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClaudeCliAdapter } from '../src/index.ts';

const fixture = fileURLToPath(new URL('./fixtures/models-fixture.mjs', import.meta.url));
function probeAdapter(calls = [], env = {}) {
  return new ClaudeCliAdapter({ spawn: (_command, args, options) => {
    calls.push(args);
    return spawn(process.execPath, [fixture], { ...options, env: { ...process.env, ...env } });
  } });
}

test('models() asks the CLI for its catalog over the stream-json control channel', async () => {
  const calls = [];
  const models = await probeAdapter(calls).models();
  assert.deepEqual(calls[0], ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--await-initialize']);
  assert.deepEqual(models, [
    { id: 'default', name: 'Default (recommended)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'opus', name: 'Opus 5.5', efforts: ['low', 'high'] },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
  ]);
});

test('models() rejects when the CLI does not answer initialize', async () => {
  await assert.rejects(probeAdapter([], { ORMICODE_FIXTURE_MODELS: 'exit' }).models(), /closed before answering/);
  await assert.rejects(probeAdapter([], { ORMICODE_FIXTURE_MODELS: 'badjson' }).models(), /control frame/);
  await assert.rejects(new ClaudeCliAdapter({ executable: 'ormicode-command-that-does-not-exist' }).models(), /failed to start|timed out/);
});

test('CLI adapter does not depend on the Claude SDK packages', () => {
  const src = new URL('../src/', import.meta.url);
  for (const file of readdirSync(src)) {
    const text = readFileSync(new URL(file, src), 'utf8');
    assert.doesNotMatch(text, /@ormicode\/agent-claude-sdk|@anthropic-ai\/claude-agent-sdk/, file);
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.equal('@ormicode/agent-claude-sdk' in deps, false);
  assert.equal('@anthropic-ai/claude-agent-sdk' in deps, false);
});
