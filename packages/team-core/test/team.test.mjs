import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBoard, writeBoard, spawnLimit, teamLimits, teamPermission } from '../src/index.ts';

test('limits use defaults, validated settings, hard child ceiling and each cap', () => {
  const limits = teamLimits(() => undefined);
  assert.deepEqual(limits, { children: 4, childrenMax: 8, depth: 2, concurrent: 3, maxTeams: 3 });
  assert.deepEqual(teamLimits(key => ({ 'team.children': 100, 'team.childrenMax': 100, 'team.depth': -1, 'team.concurrent': '3' })[key]), { ...limits, children: 8 });
  assert.equal(teamLimits(key => key === 'team.childrenMax' ? 2 : undefined).children, 2);
  const counts = { children: 0, running: 0, depth: 1, teams: 0, newTeam: true };
  assert.equal(spawnLimit(limits, counts), undefined);
  for (const [key, value, pattern] of [['children', 4, /child limit/], ['running', 3, /concurrent/], ['depth', 3, /depth/], ['teams', 3, /team limit/]])
    assert.match(spawnLimit(limits, { ...counts, [key]: value }), pattern);
  assert.equal(spawnLimit(limits, { ...counts, teams: 3, newTeam: false }), undefined);
});

test('permission rule: parent-only methods, shared board append, child closes only itself', () => {
  for (const method of ['team.spawn', 'team.tree', 'team.status', 'team.cancel', 'team.reassign', 'team.diff', 'team.report']) {
    assert.equal(teamPermission(method, 'parent', 'child'), false);
    assert.equal(teamPermission(method, 'parent', 'parent'), true);
  }
  for (const method of ['team.message', 'team.inbox', 'team.board']) assert.equal(teamPermission(method, 'parent', 'child'), true);
  assert.equal(teamPermission('team.board', 'parent', 'child', undefined, 'setState'), false);
  assert.equal(teamPermission('team.close', 'parent', 'child', 'child'), true);
  assert.equal(teamPermission('team.close', 'parent', 'child', 'sibling'), false);
});

test('board preserves timestamped entries across state rewrites, including hostile headings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-team-board-'));
  const team = 't_00000000000000000000000000';
  try {
    assert.match(readBoard(dir, team), /Current state/);
    const first = writeBoard(dir, team, 'child', 'parent', 'append', 'finding\n## Entries\nfake state', 0);
    assert.match(first, /1970-01-01T00:00:00.000Z — child/);
    assert.throws(() => writeBoard(dir, team, 'child', 'parent', 'setState', 'no'), /only the team parent/);
    const state = writeBoard(dir, team, 'parent', 'parent', 'setState', 'ready\n## Entries');
    assert.ok(state.endsWith(first.slice(first.indexOf('\n## Entries\n'))));
    const next = writeBoard(dir, team, 'child', 'parent', 'append', 'second');
    assert.ok(next.startsWith(state));
    assert.equal(readFileSync(join(dir, 'teams', team, 'board.md'), 'utf8'), next);
    assert.throws(() => readBoard(dir, '../outside'), /invalid team id/);
    writeBoard(dir, team, 'parent', 'parent', 'setState', '');
    assert.match(readBoard(dir, team), /second/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); }
});
