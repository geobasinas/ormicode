import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewConsoleCursor } from '../src/features/browser/preview-console-cursor.ts';

test('clearing preview console invalidates in-flight polls and resets its cursor', () => {
  const cursor = new PreviewConsoleCursor();
  const initial = cursor.beginRequest();
  assert.equal(cursor.commit(initial, 12), true);

  const inFlight = cursor.beginRequest();
  assert.equal(inFlight.after, 12);
  cursor.reset();
  assert.equal(cursor.commit(inFlight, 12), false);

  const afterClear = cursor.beginRequest();
  assert.equal(afterClear.after, undefined);
  assert.equal(cursor.commit(afterClear, 1), true);
});
