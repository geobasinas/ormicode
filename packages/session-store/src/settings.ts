import type { Store } from './db.ts';

/** Account settings: one JSON value per key in the `settings` table. */
export function settingValue(db: Store, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}
export function setSetting(db: Store, key: string, value: unknown): void {
  db.prepare(`INSERT INTO settings(key, value, scope) VALUES (?, ?, 'account')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, scope = excluded.scope`).run(key, JSON.stringify(value));
}
export function clearSetting(db: Store, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
