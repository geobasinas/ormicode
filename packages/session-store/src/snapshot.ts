import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import type { Store } from './db.ts';

/**
 * Consistent copy of the store for `ormi export`. VACUUM INTO reads one
 * snapshot, so it is safe while the daemon keeps writing. Device token
 * hashes are cleared and the copy is vacuumed again so no old page keeps them.
 */
export function snapshotStore(source: Store | string, dest: string): void {
  if (existsSync(dest)) throw new Error(`snapshot target exists: ${dest}`);
  const db = typeof source === 'string' ? new Database(source, { fileMustExist: true }) : source;
  try { db.prepare('VACUUM INTO ?').run(dest); }
  finally { if (typeof source === 'string') db.close(); }
  const copy = new Database(dest);
  try {
    copy.pragma('secure_delete = ON');
    const hasDevices = copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'devices'").get();
    if (hasDevices) copy.exec('UPDATE devices SET token_hash = NULL');
    copy.exec('VACUUM');
  } finally { copy.close(); }
}

/** True when another connection has the store open (the daemon, usually). */
export function storeInUse(path: string): boolean {
  if (!existsSync(path)) return false;
  const db = new Database(path, { fileMustExist: true, timeout: 0 });
  try {
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE; COMMIT');
    return false;
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith('SQLITE_BUSY') || (error as { code?: string }).code?.startsWith('SQLITE_LOCKED')) return true;
    throw error;
  } finally { db.close(); }
}
