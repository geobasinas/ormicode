import type { Store } from './db.ts';

export interface StoredPrice { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export interface PinnedPrice { price: StoredPrice; version: string }

export function getPinnedPrice(db: Store, session: string, model: string): PinnedPrice | undefined {
  const row = db.prepare(`SELECT version, input, output, cache_read, cache_write
    FROM session_prices WHERE session = ? AND model = ?`)
    .get(session, model) as { version: string; input: number; output: number; cache_read: number | null; cache_write: number | null } | undefined;
  if (!row) return undefined;
  return {
    version: row.version,
    price: {
      input: row.input, output: row.output,
      ...(row.cache_read === null ? {} : { cacheRead: row.cache_read }),
      ...(row.cache_write === null ? {} : { cacheWrite: row.cache_write }),
    },
  };
}

export function pinPrice(db: Store, session: string, model: string, price: StoredPrice, version: string): void {
  db.prepare(`INSERT INTO session_prices(session, model, version, input, output, cache_read, cache_write)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session, model) DO NOTHING`)
    .run(session, model, version, price.input, price.output, price.cacheRead ?? null, price.cacheWrite ?? null);
}
