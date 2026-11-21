import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeWorkspaceRoute } from '../src/lib/workspace-route.ts';

test('Code workspace restores an open session and falls back to Home safely', () => {
  assert.equal(codeWorkspaceRoute('s_one', ['s_one', 's_two']), 's_one');
  assert.equal(codeWorkspaceRoute('now', ['s_one']), 'now');
  assert.equal(codeWorkspaceRoute('s_closed', ['s_one']), 'now');
  assert.equal(codeWorkspaceRoute('', []), 'now');
  assert.equal(codeWorkspaceRoute('design', ['design']), 'now');
});
