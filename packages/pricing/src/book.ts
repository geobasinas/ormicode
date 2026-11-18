// Fetch-and-cache wrapper: prices are fetched on first use and refreshed once
// the cache is older than `maxAgeMs` (pricing.cacheMinutes, default a day).
// A failed fetch keeps the last cache; with no cache there are no prices.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchOpenRouter, OPENROUTER_MODELS } from './fetch.ts';
import { EMPTY, withOverrides, type PriceTable } from './table.ts';

export interface PriceStatus { version: string | null; source: 'openrouter' | 'cache' | 'none'; fetchedAt: number | null; models: number; error?: string }
export interface PriceBookOptions { cachePath: string; overridesPath?: string; url?: string | null; maxAgeMs?: number; fetch?: typeof fetch; now?: () => number }

export class PriceBook {
  private base: PriceTable = EMPTY;
  private fetchedAt: number | null = null;
  private source: PriceStatus['source'] = 'none';
  private error: string | undefined;
  private loaded = false;
  private inflight: Promise<void> | undefined;
  private readonly opts: PriceBookOptions;
  constructor(opts: PriceBookOptions) { this.opts = opts; }

  private now() { return (this.opts.now ?? Date.now)(); }
  private maxAge() { return this.opts.maxAgeMs ?? 24 * 60 * 60 * 1000; }

  private loadCache(): void {
    this.loaded = true;
    try {
      const c = JSON.parse(readFileSync(this.opts.cachePath, 'utf8')) as { fetchedAt: number; table: PriceTable };
      if (c.table?.models && typeof c.fetchedAt === 'number') { this.base = c.table; this.fetchedAt = c.fetchedAt; this.source = 'cache'; }
    } catch { /* no cache yet */ }
  }

  /** Refresh when stale (or when forced); concurrent callers share one fetch. */
  ensure(force = false): Promise<void> {
    if (!this.loaded) this.loadCache();
    const fresh = this.fetchedAt !== null && this.now() - this.fetchedAt < this.maxAge();
    if ((fresh && !force) || this.opts.url === null) return Promise.resolve();
    this.inflight ??= fetchOpenRouter(this.opts.url ?? OPENROUTER_MODELS, this.opts.fetch).then(table => {
      this.base = table; this.fetchedAt = this.now(); this.source = 'openrouter'; this.error = undefined;
      mkdirSync(dirname(this.opts.cachePath), { recursive: true });
      const tmp = `${this.opts.cachePath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ fetchedAt: this.fetchedAt, table }));
      renameSync(tmp, this.opts.cachePath);
    }, (e: unknown) => { this.error = (e as Error).message; }).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  table(): PriceTable {
    if (!this.loaded) this.loadCache();
    return this.opts.overridesPath ? withOverrides(this.base, this.opts.overridesPath) : this.base;
  }

  status(): PriceStatus {
    const t = this.table();
    return { version: t.version, source: this.source, fetchedAt: this.fetchedAt, models: Object.keys(t.models).length, ...(this.error ? { error: this.error } : {}) };
  }
}
