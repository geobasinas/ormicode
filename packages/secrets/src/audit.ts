// Access audit: JSON lines of {ts, session, name, action}. Never the value.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function audit(path: string, entry: { session?: string; name: string; action: 'inject' | 'set' | 'delete' | 'leak' }): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`, { mode: 0o600 });
}
