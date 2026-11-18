// Projects declare secret names (never values) in <project>/.ormi/secrets.yaml:
//   secrets:
//     - STRIPE_TEST_KEY
// Only that list form is read; anything else in the file is ignored.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { account, type Keyring } from './keyring.ts';

export const NAME = /^[A-Z_][A-Z0-9_]*$/;

export function declared(project: string): string[] {
  let text: string;
  try { text = readFileSync(join(project, '.ormi', 'secrets.yaml'), 'utf8'); } catch { return []; }
  const names: string[] = []; let inList = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (/^secrets:\s*$/.test(line)) { inList = true; continue; }
    if (/^\S/.test(line)) inList = false;
    const m = inList ? /^\s+-\s+["']?([A-Za-z0-9_]+)["']?\s*$/.exec(line) : null;
    if (m && NAME.test(m[1]!)) names.push(m[1]!);
  }
  return [...new Set(names)];
}

/** Project scope wins over machine scope. */
export function resolve(keyring: Keyring, project: string): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {}; const missing: string[] = [];
  for (const name of declared(project)) {
    const v = keyring.get(account(name, project)) ?? keyring.get(account(name));
    if (v === undefined) missing.push(name); else env[name] = v;
  }
  return { env, missing };
}
