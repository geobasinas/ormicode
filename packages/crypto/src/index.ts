/** Token + hashing helpers for pairing. WebCrypto only — runs on Workers and Node. */

const b64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 32 random bytes, base64url — device and hub tokens. */
export function randomToken(): string {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** 12 random digits rendered `#### #### ####` (~40 bits, per spec). */
export function randomCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const digits = Array.from(bytes, b => String(b % 10)).join('');
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

/** Code with spaces stripped, for comparisons. */
export const normalizeCode = (code: string): string => code.replace(/\D/g, '');

export async function sha256hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish compare of two hex digests (no early exit on mismatch). */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
