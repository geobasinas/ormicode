import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { newId } from '@ormicode/protocol';
import { AgentBrowser } from '../src/agent-browser.ts';

function png(width, height, colors) {
  const image = new PNG({ width, height });
  image.data.set(colors.flat());
  return PNG.sync.write(image);
}

test('browser diff counts padding, stores a red artifact, caches pairs, and validates limits', () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-browser-diff-'));
  const session = newId('s');
  const directory = join(root, 'sessions', session, 'browser');
  mkdirSync(directory, { recursive: true });
  const a = newId('bl');
  const b = newId('bl');
  const oversized = newId('bl');
  writeFileSync(join(directory, `${a}.png`), png(1, 1, [[255, 255, 255, 255]]));
  writeFileSync(join(directory, `${b}.png`), png(2, 1, [[255, 255, 255, 255], [0, 0, 0, 255]]));
  writeFileSync(join(directory, `${oversized}.png`), Buffer.alloc(4 * 1024 * 1024 + 1));
  const browser = new AgentBrowser(root, {});
  try {
    const result = browser.diff(session, a, b);
    assert.deepEqual(
      { changed: result.changed, total: result.total, percent: result.percent, width: result.width, height: result.height },
      { changed: 1, total: 2, percent: 50, width: 2, height: 1 },
    );
    assert.equal(browser.diff(session, a, b).artifact, result.artifact);
    const image = PNG.sync.read(Buffer.from(browser.artifact(session, result.artifact).data, 'base64'));
    assert.deepEqual([...image.data.subarray(4, 8)], [255, 0, 0, 255]);
    assert.throws(() => browser.diff(session, '../store.db', b), /Artifact not found/);
    assert.throws(() => browser.diff(session, oversized, b), /4 MiB/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});
