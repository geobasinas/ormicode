import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame, parseRequestBody, parseResponseBody, sessionIdSchema } from '../src/index.ts';
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
  assert.equal(parseRequestBody('session.prompt', { session: s, text: '', images: [{ data: 'aGk=', mimeType: 'image/png' }] }).success, false);
  assert.equal(parseRequestBody('session.prompt', { session: s, text: 'hi', images: [{ data: 'aGk=', mimeType: 'image/png' }] }).success, true);
  assert.equal(parseRequestBody('session.prompt', { session: s, text: 'hi', images: [{ data: '', mimeType: 'image/png' }] }).success, false);
  assert.equal(parseRequestBody('session.prompt', { session: s, text: 'hi', images: [{ data: 'aGk=' }] }).success, false);
  assert.equal(parseRequestBody('session.steer', { session: s, text: 'hi', images: [{ data: 'aGk=', mimeType: 'image/png' }] }).success, true);
  assert.equal(parseRequestBody('session.prompt', { session: s, text: '' }).success, false);
  assert.equal(parseRequestBody('session.prompt', { session: 'bad', text: 'hi' }).success, false);
  assert.deepEqual(parseRequestBody('session.teleport', {}), { success: false, error: 'protocol.unknown_method' });
  assert.deepEqual(parseRequestBody('toString', {}), { success: false, error: 'protocol.unknown_method' });
});

test('session details carry what actually ran and the advertised pickers', () => {
  const base = { id: s, title: null, state: 'idle', project: 'p', vendor: 'grok', transport: 'acp', updatedAt: 1, model: null, effort: null };
  assert.equal(parseResponseBody('session.get', { ...base, acpVersion: 1, nativeId: 'native-1', agentVersion: '1.0.77' }).success, true);
  assert.equal(parseResponseBody('session.get', { ...base, acpVersion: 2 }).success, true);
  assert.equal(parseResponseBody('session.get', { ...base, acpVersion: 3 }).success, false);
  assert.equal(parseResponseBody('session.get', { ...base, nativeId: '' }).success, false);
  const option = { id: 'mode', category: 'mode', type: 'select', current: 'ask', choices: [{ value: 'ask' }, { value: 'code' }] };
  assert.equal(parseResponseBody('session.get', { ...base, options: [option], modes: [{ id: 'ask', name: 'Ask' }] }).success, true);
  assert.equal(parseResponseBody('session.get', { ...base, options: [{ id: '' }] }).success, false);
  assert.equal(parseResponseBody('session.get', base).success, true);
});
