// Model price table, USD per million tokens. There is no built-in list: prices
// come from OpenRouter (see fetch.ts), plus hand edits in ~/.ormicode/prices.json
// ({models: {id: Price}}). Unknown model = no price (tokens and a dash, never a guess).
import { readFileSync } from 'node:fs';

export interface Price { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export interface PriceTable { version: string | null; models: Record<string, Price> }

export const EMPTY: PriceTable = { version: null, models: {} };

/** `anthropic/claude-sonnet-4.6` and `claude-sonnet-4-6-20260217` both → `claude-sonnet-4-6`. */
export function normalizeModel(id: string): string {
  return id.toLowerCase().trim().replace(/^.*\//, '').replace(/:.*$/, '').replace(/\./g, '-')
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '').replace(/@.*$/, '');
}

/** Exact match after normalising only — a near miss is a guess. */
export function priceFor(table: PriceTable, model: string | null | undefined): Price | undefined {
  if (!model) return undefined;
  return table.models[normalizeModel(model)];
}

/** Hand edits win over fetched prices and mark the version as edited. */
export function withOverrides(table: PriceTable, path: string): PriceTable {
  let raw: { models?: Record<string, Price> };
  try { raw = JSON.parse(readFileSync(path, 'utf8')) as typeof raw; } catch { return table; }
  if (!raw.models || typeof raw.models !== 'object') return table;
  const models = { ...table.models };
  for (const [id, p] of Object.entries(raw.models)) models[normalizeModel(id)] = p;
  return { version: `${table.version ?? 'none'}+manual`, models };
}
