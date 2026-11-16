import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame, parseRequestBody, sessionIdSchema } from '../src/index.ts';
import * as z from 'zod/mini';

const s = 's_01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const req = 'req_01J8Z3K4M5N6P7Q8R9S0T1V2W3';

test('validates IDs, including ULID overflow and alphabet', () => {
  assert.equal(z.safeParse(sessionIdSchema, s).success, true);
  assert.equal(z.safeParse(sessionIdSchema, 's_81J8Z3K4M5N6P7Q8R9S0T1V2W3').success, false);
  assert.equal(z.safeParse(sessionIdSchema, 's_01I8Z3K4M5N6P7Q8R9S0T1V2W3').success, false);
});

test('validates request envelopes and refuses invalid wire values', () => {
  const frame = { v: 1, type: 'req', id: req, method: 'session.prompt', body: { session: s, text: 'hello' }, ts: 1 };
  assert.equal(parseFrame(frame).success, true);
  assert.equal(parseFrame({ ...frame, v: 2 }).success, false);
  assert.equal(parseFrame({ ...frame, body: null }).success, false);
  assert.equal(parseFrame({ ...frame, body: { invalid: undefined } }).success, false);
  assert.equal(parseFrame({ ...frame, ts: -1 }).success, false);
});

test('validates per-session acknowledgements and cursors', () => {
  assert.equal(parseFrame({ v: 1, type: 'ack', session: s, seq: 1 }).success, true);
  assert.equal(parseFrame({ v: 1, type: 'ack', seq: 1 }).success, false);
  assert.equal(parseFrame({ v: 1, type: 'ack', session: s, seq: 0 }).success, false);
  assert.equal(parseRequestBody('session.subscribe', { session: s, after: 0 }).success, true);
  assert.equal(parseRequestBody('session.subscribe', { session: s, after: -1 }).success, false);
});

test('preserves durable event data and validates ephemeral deltas', () => {
  const event = { v: 1, type: 'evt', session: s, seq: 3, ts: 1, body: { kind: 'text', text: 'hello' }, vendor: 'fake' };
  const parsed = parseFrame(event);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data, event);
  assert.equal(parseFrame({ v: 1, type: 'evt', session: s, ts: 1, body: { kind: 'text_delta', text: 'a' } }).success, true);
  assert.equal(parseFrame({ v: 1, type: 'evt', session: s, ts: 1, body: { kind: 'text' } }).success, false);
  assert.equal(parseFrame({ v: 1, type: 'evt', session: s, seq: 3, ts: 1, body: { kind: 'text_delta', text: 'a' } }).success, false);
});

test('method validation rejects unknown operations and bad bodies', () => {
  assert.equal(parseRequestBody('session.prompt', { session: s, text: 'hello' }).success, true);
  assert.equal(parseRequestBody('session.prompt', { session: s, text: '' }).success, false);
  assert.equal(parseRequestBody('session.prompt', { session: 'bad', text: 'hi' }).success, false);
  assert.deepEqual(parseRequestBody('session.handoff', {}), { success: false, error: 'protocol.unknown_method' });
  assert.deepEqual(parseRequestBody('toString', {}), { success: false, error: 'protocol.unknown_method' });
});
