import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Store = Database.Database;

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Open the store, apply pending NNNN-name.sql migrations, WAL + busy_timeout per spec. */
export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Store): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  const files = readdirSync(MIGRATIONS).filter(f => /^\d{4}-.+\.sql$/.test(f)).sort();
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (version <= current) continue;
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
