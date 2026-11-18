import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryKeyring, account, declared, resolve, Redactor, audit } from '../src/index.ts';

test('declared names resolve project scope before machine scope and report missing', () => {
  const project = mkdtempSync(join(tmpdir(), 'ormi-sec-'));
  mkdirSync(join(project, '.ormi'));
  writeFileSync(join(project, '.ormi', 'secrets.yaml'), 'secrets:\n  - STRIPE_TEST_KEY\n  - "DATABASE_URL" # db\n  - bad-name\nother:\n  - NOT_A_SECRET\n');
  assert.deepEqual(declared(project), ['STRIPE_TEST_KEY', 'DATABASE_URL']);
  const kr = new MemoryKeyring();
  kr.set(account('STRIPE_TEST_KEY'), 'machine-value');
  kr.set(account('STRIPE_TEST_KEY', project), 'sk_test_project');
  assert.deepEqual(resolve(kr, project), { env: { STRIPE_TEST_KEY: 'sk_test_project' }, missing: ['DATABASE_URL'] });
  assert.deepEqual(declared(join(project, 'nope')), []);
});

test('Redactor replaces values in nested payloads and reports which leaked', () => {
  const r = new Redactor({ A: 'sk_test_123', B: 'sk_test_1234567', SHORT: 'x' });
  const hits = new Set();
  const out = r.deep({ text: 'key sk_test_1234567 and sk_test_123', input: { args: ['sk_test_123'] }, n: 3, x: 'x' }, hits);
  assert.deepEqual(out, { text: 'key [redacted:B] and [redacted:A]', input: { args: ['[redacted:A]'] }, n: 3, x: 'x' });
  assert.deepEqual([...hits].sort(), ['A', 'B']);
});

test('audit lines carry names, never values', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'ormi-audit-')), 'logs', 'a.jsonl');
  audit(p, { session: 's_1', name: 'API_KEY', action: 'inject' });
  const line = JSON.parse(readFileSync(p, 'utf8'));
  assert.deepEqual([line.session, line.name, line.action, typeof line.ts], ['s_1', 'API_KEY', 'inject', 'number']);
});
