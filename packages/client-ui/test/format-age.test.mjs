import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, agoText } from '../src/lib/format.ts';
const now = Date.UTC(2026, 6, 1);

test('ages under a minute say now, never 0m', () => {
  for (const seconds of [0, 44, 45, 59]) assert.equal(ago(now - seconds * 1000, now), 'now');
  assert.equal(ago(now - 60000, now), '1m');
  assert.equal(ago(now - 3600000, now), '1h');
  assert.equal(ago(now - 172800000, now), '2d');
  assert.equal(ago(now + 1000, now), 'now');
});
test('absent, zero and invalid timestamps have no age or dangling ago suffix', () => {
  for (const timestamp of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(ago(timestamp, now), ''); assert.equal(agoText(timestamp, now), '');
  }
});
test('epoch seconds and milliseconds render the same age', () => {
  assert.equal(ago((now - 180000) / 1000, now), '3m');
  assert.equal(ago(now - 180000, now), '3m');
  assert.equal(agoText(now - 59000, now), 'just now');
});
