import * as z from 'zod/mini';

export const idPrefixes = ['s', 'req', 'a', 'bl', 'd', 'n', 'm', 't'] as const;
export const ulidSchema = z.string().check(z.regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/));

export function idSchema(prefix: (typeof idPrefixes)[number]) {
  return z.string().check(z.regex(new RegExp(`^${prefix}_[0-7][0-9A-HJKMNP-TV-Z]{25}$`)));
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** ULID per spec: 48-bit ms time + 80 bits random, Crockford base32, prefixed `s_/req_/...`. */
export function newId(prefix: (typeof idPrefixes)[number], now = Date.now(), random: () => number = Math.random): string {
  let out = '';
  let t = now;
  for (let i = 0; i < 10; i++) { out = CROCKFORD[t % 32] + out; t = Math.floor(t / 32); }
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(random() * 32)];
  return `${prefix}_${out}`;
}

export const sessionIdSchema = idSchema('s');
export const requestIdSchema = idSchema('req');
export const deviceIdSchema = idSchema('d');
export const terminalIdSchema = idSchema('t');
export const timestampSchema = z.number().check(z.int(), z.gte(0));
export const sequenceSchema = z.number().check(z.int(), z.gte(1));
export const cursorSchema = z.number().check(z.int(), z.gte(0));
export const jsonObjectSchema = z.record(z.string(), z.json());
