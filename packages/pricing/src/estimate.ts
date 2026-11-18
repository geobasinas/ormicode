// Session totals from stored usage events: tokens always, dollars only when
// real (agent-reported costUsd) or estimated from a known list price.
import { priceFor, type Price, type PriceTable } from './table.ts';

export interface Usage { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number }
export interface CostSummary {
  input: number; output: number; cacheRead: number; cacheWrite: number; turns: number;
  usd: number | null; source: 'reported' | 'estimate' | 'none'; priceVersion: string | null; model: string | null;
}

export function costOf(u: Usage, p: Price): number {
  return ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output
    + (u.cacheRead ?? 0) * (p.cacheRead ?? p.input) + (u.cacheWrite ?? 0) * (p.cacheWrite ?? p.input)) / 1e6;
}

/** Turns that report costUsd use it; other turns are estimated; any unpriced turn without a reported cost makes the dollar figure null. */
export function summarize(
  events: { kind: string; payload: Record<string, unknown> }[],
  model: string | null,
  table: PriceTable,
  pinned?: { price: Price; version: string },
): CostSummary {
  const sum: CostSummary = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, usd: 0, source: 'none', priceVersion: null, model };
  const price = pinned?.price ?? priceFor(table, model);
  let reported = false; let estimated = false;
  for (const e of events) {
    if (e.kind === 'turn_end') sum.turns++;
    if (e.kind !== 'usage') continue;
    const u = e.payload as Usage;
    sum.input += u.input ?? 0; sum.output += u.output ?? 0; sum.cacheRead += u.cacheRead ?? 0; sum.cacheWrite += u.cacheWrite ?? 0;
    if (typeof u.costUsd === 'number') { reported = true; if (sum.usd !== null) sum.usd += u.costUsd; }
    else if (price) { estimated = true; if (sum.usd !== null) sum.usd += costOf(u, price); }
    else sum.usd = null;
  }
  sum.source = estimated ? 'estimate' : reported ? 'reported' : 'none';
  if (sum.source === 'none' && sum.usd === 0) sum.usd = null;
  if (estimated) sum.priceVersion = pinned?.version ?? table.version ?? null;
  return sum;
}
