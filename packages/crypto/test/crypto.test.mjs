import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomToken, randomCode, normalizeCode, sha256hex, hashesEqual } from '../src/index.ts';

test('tokens are 32 random bytes in base64url', () => {
  const a = randomToken(); const b = randomToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a, b);
});

test('pairing codes are 12 digits grouped by four and normalise back', () => {
  const c = randomCode();
  assert.match(c, /^\d{4} \d{4} \d{4}$/);
  assert.equal(normalizeCode(c), c.replace(/ /g, ''));
  assert.equal(normalizeCode(' 1234-5678 9012 '), '123456789012');
});

test('sha256hex matches the known vector and hashesEqual compares exactly', async () => {
  const h = await sha256hex('abc');
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hashesEqual(h, h), true);
  assert.equal(hashesEqual(h, `${h.slice(0, -1)}e`), false);
  assert.equal(hashesEqual(h, h.slice(1)), false);
});
