import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawLog } from '../src/raw-log.ts';

test('writes stdout/stderr/meta and drops oldest bytes past the cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-rawlog-'));
  const log = new RawLog(dir);
  log.out('line one\n');
  log.err('oops\n');
  log.meta({ command: 'vibe --output streaming', cwd: '/p' });
  log.meta({ exitCode: 0 });
  assert.equal(readFileSync(join(dir, 'stdout.log'), 'utf8'), 'line one\n');
  assert.equal(readFileSync(join(dir, 'stderr.log'), 'utf8'), 'oops\n');
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.command, 'vibe --output streaming');
  assert.equal(meta.exitCode, 0);
  // Cap: write >5 MB, oldest bytes gone.
  log.out(Buffer.alloc(5 * 1024 * 1024 + 64, 'x'));
  assert.equal(statSync(join(dir, 'stdout.log')).size <= 5 * 1024 * 1024, true);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
});

test('undefined dir is a no-op', () => {
  const log = new RawLog(undefined);
  log.out('x'); log.err('y'); log.meta({ a: 1 }); // must not throw
});
