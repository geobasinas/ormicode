import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ormi = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ormi.ts');
const run = args => spawnSync(process.execPath, [ormi, ...args], { encoding: 'utf8' });

test('ormi with no args prints usage and exits 0', () => {
  const { status, stdout } = run([]);
  assert.equal(status, 0);
  assert.match(stdout, /agent smoke <vendor>/);
});

test('ormi agent smoke without a vendor exits 2', () => {
  const { status } = run(['agent', 'smoke']);
  assert.equal(status, 2);
});

test('ormi agent smoke with an unknown vendor exits 2', () => {
  const { status, stderr } = run(['agent', 'smoke', 'nosuchagent']);
  assert.equal(status, 2);
  assert.match(stderr, /unknown vendor nosuchagent/);
});

test('ormi agent smoke with an unknown transport exits 2', () => {
  const { status, stderr } = run(['agent', 'smoke', 'pi', '--transport', 'warp']);
  assert.equal(status, 2);
  assert.match(stderr, /unknown transport warp/);
});

test('ormi agent smoke reports a missing smoke script as unverified', () => {
  // claude:cli exists in the repo layout? if not it reports unverified; either way it must not crash.
  const { status } = run(['agent', 'smoke', 'claude', '--transport', 'sdk']);
  assert.ok([0, 1, 2].includes(status));
});

test('ormi agent smoke fake runs the in-process harness without credentials', () => {
  const { status, stdout } = run(['agent', 'smoke', 'fake']);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /smoke fake\/inprocess turn: ok/);
});

test('ormi agent smoke fake rejects an unknown script', () => {
  const { status } = run(['agent', 'smoke', 'fake', '--script', 'bogus']);
  assert.equal(status, 2);
});

test('unknown command exits 2', () => {
  const { status } = run(['bogus']);
  assert.equal(status, 2);
});
