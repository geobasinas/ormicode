import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAgentModes } from '../src/models.ts';

const UNSAFE = ['bypassPermissions', 'danger-full-access', 'manual'];
const cwd = mkdtempSync(join(tmpdir(), 'ormi-modes-'));
const expected = {
  'claude/cli': 'default', 'claude/sdk': 'default', 'codex/cli': 'read-only', 'codex/sdk': 'workspace-write',
  'grok/cli': 'always-approve', 'grok/acp': 'ask', 'vibe/cli': 'accept-edits', 'vibe/acp': 'accept-edits',
  'pi/cli': 'full', 'pi/sdk': 'full',
};

for (const [key, fallback] of Object.entries(expected)) {
  test(`${key} lists each mode once, with one default and the vendor's names`, async () => {
    process.env.VIBE_HOME = join(cwd, 'no-vibe-home');
    const [agent, transport] = key.split('/');
    const { modes } = await listAgentModes({ agent, transport, cwd });
    const ids = modes.map(m => m.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids}`);
    assert.deepEqual(modes.filter(m => m.default).map(m => m.id), [fallback]);
    assert.ok(!ids.some(id => UNSAFE.includes(id)), ids.join());
    for (const m of modes) assert.ok(m.name && m.description, `${m.id} needs a name and description`);
  });
}
