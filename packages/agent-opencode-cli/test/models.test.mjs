import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCodeCliAdapter } from '../src/index.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = new URL('./fixtures/opencode-models.mjs', import.meta.url).href;
function fakeOpenCode(serve) {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-opencode-models-'));
  const executable = join(dir, 'opencode.mjs');
  writeFileSync(executable, `#!${process.execPath}\n${serve === 'fail' ? "process.env.ORMICODE_FAKE_SERVE = 'fail';\n" : ''}await import(${JSON.stringify(fixture)});\n`);
  chmodSync(executable, 0o755);
  return { executable, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
test('src/ and package.json do not mention @ormicode/agent-opencode-sdk', () => {
  for (const file of [...files(join(root, 'src')), join(root, 'package.json')]) assert.doesNotMatch(readFileSync(file, 'utf8'), /@ormicode\/agent-opencode-sdk/, file);
});
test('models() prefers opencode serve + model/list for ids, names and variants', async () => {
  const fake = fakeOpenCode('ok');
  try {
    assert.deepEqual(await new OpenCodeCliAdapter({ executable: fake.executable }).models(), [
      { id: 'prov/model-1', name: 'Model One', efforts: ['low', 'high'] },
      { id: 'prov/model-2' },
    ]);
  } finally { fake.cleanup(); }
});
test('models() falls back to parsing opencode models stdout when serve fails', async () => {
  const fake = fakeOpenCode('fail');
  try { assert.deepEqual(await new OpenCodeCliAdapter({ executable: fake.executable }).models(), [{ id: 'prov/model-1' }, { id: 'prov/model-2' }]); }
  finally { fake.cleanup(); }
});
test('models() returns an empty list when neither serve nor models works', async () => {
  assert.deepEqual(await new OpenCodeCliAdapter({ executable: join(tmpdir(), 'ormi-no-such-opencode') }).models(), []);
});
