import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_TOKEN_LIMIT, designTokenSchema, designTokensSchema, validateStyleEdit } from '../src/index.ts';

test('board tokens are typed, uniquely named and bounded; bindings and images share a strict style allowlist', () => {
  const token = { name: 'brand-blue', kind: 'color', value: '#123def' };
  assert.equal(designTokenSchema.safeParse(token).success, true);
  for (const patch of [
    { name: '--external' }, { name: 'foo\n' }, { name: 'a'.repeat(41) }, { value: '#fff;opacity:0' },
    { value: 'var(--ormi-design-brand)' }, { value: 'url(https://example.invalid)' }, { kind: 'spacing' }, { extra: 1 },
  ]) assert.equal(designTokenSchema.safeParse({ ...token, ...patch }).success, false);
  assert.equal(designTokensSchema.safeParse([token, token]).success, false);
  assert.equal(designTokensSchema.safeParse(Array.from({ length: DESIGN_TOKEN_LIMIT + 1 }, (_, i) => ({ ...token, name: 'token-' + i }))).success, false);
  assert.equal(validateStyleEdit('borderLeftColor', 'var(--ormi-design-brand-blue)'), true);
  assert.equal(validateStyleEdit('position', 'var(--ormi-design-brand-blue)'), false);
  assert.equal(validateStyleEdit('color', 'var(--local-token)'), false);
  assert.equal(validateStyleEdit('fontFamily', '"Trebuchet MS", Arial, sans-serif'), true);
  assert.equal(validateStyleEdit('backgroundImage', 'url("data:image/png;base64,AAAA")'), true);
  assert.equal(validateStyleEdit('backgroundImage', 'url("data:image/svg+xml;base64,AAAA")'), false);
  assert.equal(validateStyleEdit('backgroundImage', 'url("data:image/png;base64,' + 'a'.repeat(8192) + '")'), false);
  assert.equal(validateStyleEdit('gridTemplateColumns', 'repeat(3, 1fr)'), true);
  assert.equal(validateStyleEdit('gridTemplateColumns', 'repeat(9999, 1fr)'), false);
  assert.equal(validateStyleEdit('aspectRatio', '390 / 844'), true);
  assert.equal(validateStyleEdit('top', '-32.5px'), true);
});
