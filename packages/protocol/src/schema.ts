import * as z from 'zod/mini';

export const idPrefixes = ['s', 'req', 'a', 'bl', 'd', 'n', 'm'] as const;
export const ulidSchema = z.string().check(z.regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/));

export function idSchema(prefix: (typeof idPrefixes)[number]) {
  return z.string().check(z.regex(new RegExp(`^${prefix}_[0-7][0-9A-HJKMNP-TV-Z]{25}$`)));
}

export const sessionIdSchema = idSchema('s');
export const requestIdSchema = idSchema('req');
export const deviceIdSchema = idSchema('d');
export const timestampSchema = z.number().check(z.int(), z.gte(0));
export const sequenceSchema = z.number().check(z.int(), z.gte(1));
export const cursorSchema = z.number().check(z.int(), z.gte(0));
export const jsonObjectSchema = z.record(z.string(), z.json());
