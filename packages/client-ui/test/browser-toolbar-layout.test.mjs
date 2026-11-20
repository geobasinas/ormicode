import test from 'node:test';
import assert from 'node:assert/strict';
import { browserToolbarOverflow } from '../src/features/browser/browser-toolbar-layout.ts';

test('moves toolbar controls into overflow from lowest to highest priority', () => {
  assert.deepEqual(browserToolbarOverflow(400), { device: true, console: true, draw: true, pick: true });
  assert.deepEqual(browserToolbarOverflow(520), { device: true, console: true, draw: true, pick: false });
  assert.deepEqual(browserToolbarOverflow(610), { device: true, console: false, draw: false, pick: false });
  assert.deepEqual(browserToolbarOverflow(663), { device: false, console: false, draw: false, pick: false });
  assert.deepEqual(browserToolbarOverflow(900), { device: false, console: false, draw: false, pick: false });
});
