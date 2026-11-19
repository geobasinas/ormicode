import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendLayoutHistory, applyLayout, defaultLayout, revertLayout, validateLayout } from '../src/lib/layout.ts';

test('layout history keeps twenty descriptors and can revert', () => {
  let history = [];
  for (let i = 0; i < 22; i++) history = appendLayoutHistory(history, {
    version: 1, source: 'user', regions: { sidebar: { order: 0, size: 220 + i } },
  }, i);
  assert.equal(history.length, 20);
  assert.equal(history[0].timestamp, 21);
  assert.equal(revertLayout(history, 0)?.regions.sidebar?.size, 241);
  assert.equal(revertLayout(history, 0)?.source, 'user');
});

test('safe mode rejects non-user patches and approval cannot be hidden', () => {
  const agent = { version: 1, source: 'agent', regions: { sidebar: { order: 0, visible: false } } };
  assert.equal(applyLayout(defaultLayout, agent, true), defaultLayout);
  const user = { ...agent, source: 'user', regions: { approval: { order: 0, visible: false } } };
  assert.notEqual(applyLayout(defaultLayout, user).regions.approval?.visible, false);
  assert.ok(validateLayout(user).errors.includes('approval surface cannot be hidden'));
});

test('layout validation reports unknown region ids', () => {
  assert.deepEqual(validateLayout({ version: 1, regions: { mystery: { order: 0 } } }).unknown, ['mystery']);
});
