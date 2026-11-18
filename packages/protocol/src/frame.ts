import * as z from 'zod/mini';
import { cursorSchema, deviceIdSchema, jsonObjectSchema, requestIdSchema, sequenceSchema, sessionIdSchema, terminalIdSchema, timestampSchema } from './schema.ts';
import { methodNameSchema } from './methods.ts';

export const PROTOCOL_VERSION = 1 as const;
const base = { v: z.literal(PROTOCOL_VERSION) };
const codeSchema = z.string().check(z.regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/));
const request = z.looseObject({ ...base, type: z.literal('req'), id: requestIdSchema, method: methodNameSchema, body: jsonObjectSchema, ts: timestampSchema });
const response = z.looseObject({ ...base, type: z.literal('res'), id: requestIdSchema, ok: z.literal(true), body: jsonObjectSchema });
const error = z.looseObject({ ...base, type: z.literal('err'), id: requestIdSchema, code: codeSchema, message: z.string() });
const durableKind = z.string().check(z.refine((kind) => kind !== 'text_delta' && kind !== 'thinking_delta'));
const event = z.looseObject({ ...base, type: z.literal('evt'), session: sessionIdSchema, seq: sequenceSchema, ts: timestampSchema, body: z.looseObject({ kind: durableKind.check(z.minLength(1)) }) });
const delta = z.looseObject({ ...base, type: z.literal('evt'), session: sessionIdSchema, ts: timestampSchema, body: z.looseObject({ kind: z.enum(['text_delta', 'thinking_delta']), text: z.string() }) }).check(z.refine((frame) => !Object.hasOwn(frame, 'seq')));
const ack = z.looseObject({ ...base, type: z.literal('ack'), session: sessionIdSchema, seq: sequenceSchema });
const hello = z.looseObject({ ...base, type: z.literal('hello'), role: z.enum(['hub', 'node', 'client', 'worker']), proto: sequenceSchema, daemon: z.optional(z.string()), device: z.optional(z.string()) });
const index = z.looseObject({ ...base, type: z.literal('idx'), to: deviceIdSchema, ts: timestampSchema, body: jsonObjectSchema });
const hook = z.looseObject({ ...base, type: z.literal('hook'), account: z.string(), delivery: z.string(), body: jsonObjectSchema });
// Terminal stream (not journaled): base64 output chunks at a byte offset, then an exit marker.
const term = z.looseObject({ ...base, type: z.literal('term'), terminal: terminalIdSchema, body: z.union([
  z.looseObject({ kind: z.literal('terminal_output'), offset: cursorSchema, data: z.string() }),
  z.looseObject({ kind: z.literal('terminal_exit'), code: z.nullable(z.number()) }),
]) });
export const frameSchema = z.union([request, response, error, event, delta, ack, hello, index, hook, term]);
export type Frame = z.infer<typeof frameSchema>;
export { cursorSchema };

/** Frame parsing validates the envelope. Method and event bodies need their own schemas. */
export function parseFrame(value: unknown) {
  const json = z.safeParse(z.json(), value);
  return json.success ? z.safeParse(frameSchema, json.data) : json;
}

export const MAX_FRAME_BYTES = 256 * 1024;
/** Parse one UTF-8 JSON frame; the transport is responsible for enforcing its own limits too. */
export function parseWireFrame(input: string) {
  if (new TextEncoder().encode(input).byteLength > MAX_FRAME_BYTES) {
    return { success: false as const, error: 'protocol.invalid_frame' as const };
  }
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return { success: false as const, error: 'protocol.invalid_frame' as const };
  }
  if (typeof value === 'object' && value !== null && 'v' in value && value.v !== PROTOCOL_VERSION) {
    return { success: false as const, error: 'protocol.unsupported_version' as const };
  }
  const result = parseFrame(value);
  return result.success ? result : { success: false as const, error: 'protocol.invalid_frame' as const, issues: result.error.issues };
}
