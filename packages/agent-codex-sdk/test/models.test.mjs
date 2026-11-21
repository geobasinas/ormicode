import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexSdkAdapter } from '../src/index.ts';

const pkg = fileURLToPath(new URL('..', import.meta.url));
// Minimal stand-in for `codex app-server --listen stdio://`: initialize, then model/list.
const server = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
let initialized = false;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (process.argv[1] === 'crash') process.exit(2);
  if (m.method === 'initialize') out({ id: m.id, result: { userAgent: 'fixture', codexHome: '/tmp', platformFamily: 'test', platformOs: 'test' } });
  else if (m.method === 'initialized') initialized = true;
  else if (m.method === 'model/list') out(initialized
    ? { id: m.id, result: { data: [{ id: 'gpt-test-1', displayName: 'GPT Test', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }, { id: 'plain' }, { id: 'hidden-model', hidden: true }], nextCursor: null } }
    : { id: m.id, error: { code: -32000, message: 'not initialized' } });
});`;

test('SDK package never mentions the Codex CLI adapter', () => {
  const files = [join(pkg, 'package.json'), ...readdirSync(join(pkg, 'src')).map((name) => join(pkg, 'src', name))];
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /@ormicode\/agent-codex-cli/, file);
});

test('SDK adapter lists models over the official app-server model/list and closes the server', async () => {
  const children = [];
  const adapter = new CodexSdkAdapter({ client: {}, spawn: (cmd, args, options) => {
    assert.equal(cmd, 'codex'); assert.deepEqual(args, ['app-server', '--listen', 'stdio://']);
    const child = spawn(process.execPath, ['-e', server], options); children.push(child); return child;
  } });
  assert.deepEqual(await adapter.models(), [{ id: 'gpt-test-1', name: 'GPT Test', efforts: ['low', 'high'] }, { id: 'plain' }]);
  assert.equal(children.length, 1);
  if (children[0].exitCode === null && children[0].signalCode === null) await new Promise((resolve) => children[0].once('close', resolve));
});

test('SDK adapter models() fails when the app-server exits early', async () => {
  const adapter = new CodexSdkAdapter({ client: {}, spawn: (_cmd, _args, options) => spawn(process.execPath, ['-e', server, 'crash'], options) });
  await assert.rejects(adapter.models(), /closed before model\/list/);
});
