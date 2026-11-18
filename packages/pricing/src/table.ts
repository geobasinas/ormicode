// Model price table, USD per million tokens. Built-in list prices, overridable
// by hand in ~/.ormicode/prices.json ({version?, models: {id: Price}}).
// Unknown model = no price (callers show tokens and a dash, never a guess).
import { readFileSync } from 'node:fs';

export interface Price { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export interface PriceTable { version: string; models: Record<string, Price> }

export const BUILTIN: PriceTable = {
  version: 'builtin-2025-08',
  models: {
    'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
    'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
    'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005 },
  },
};

export function loadTable(path?: string): PriceTable {
  if (!path) return BUILTIN;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<PriceTable>;
    if (!raw.models || typeof raw.models !== 'object') return BUILTIN;
    return { version: raw.version ?? `manual+${BUILTIN.version}`, models: { ...BUILTIN.models, ...raw.models } };
  } catch { return BUILTIN; }
}

/** Exact id, then the longest table key the id starts with (`claude-sonnet-4-20250514` → `claude-sonnet-4`). */
export function priceFor(table: PriceTable, model: string | null | undefined): Price | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase().replace(/^[a-z]+\//, '');
  if (table.models[id]) return table.models[id];
  const key = Object.keys(table.models).filter(k => id.startsWith(`${k}-`) || id.startsWith(`${k}@`)).sort((a, b) => b.length - a.length)[0];
  return key ? table.models[key] : undefined;
}
