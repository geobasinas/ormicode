import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ClaudeCliAdapter } from '../src/index.ts';

test('models() returns the documented claude --model aliases without spawning anything', async () => {
  const adapter = new ClaudeCliAdapter({ spawn: () => { throw new Error('models() must not spawn'); } });
  const models = await adapter.models();
  assert.deepEqual(models.map((m) => m.id), ['default', 'best', 'fable', 'opus', 'sonnet', 'haiku', 'opus[1m]', 'sonnet[1m]', 'opusplan']);
  for (const model of models) assert.equal(typeof model.name, 'string');
  assert.ok(Object.isFrozen(models));
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
