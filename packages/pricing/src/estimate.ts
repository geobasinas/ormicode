// Session totals from stored usage events: tokens always, dollars only when
// real (agent-reported costUsd) or estimated from a known list price.
import { normalizeModel, priceFor, type Price, type PriceTable } from './table.ts';

export interface Usage { model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; costCumulativeUsd?: number }
export interface CostSummary {
  input: number; output: number; cacheRead: number; cacheWrite: number; turns: number;
  usd: number | null; source: 'reported' | 'estimate' | 'none'; priceVersion: string | null; model: string | null;
}

export function costOf(u: Usage, p: Price): number {
  return ((u.input ?? 0) * p.input + (u.output ?? 0) * p.output
    + (u.cacheRead ?? 0) * (p.cacheRead ?? p.input) + (u.cacheWrite ?? 0) * (p.cacheWrite ?? p.input)) / 1e6;
}

/** Per-turn cost from a running session total (Claude's total_cost_usd). A drop means the total restarted; a zeroed total (crash results) costs 0 and keeps the baseline. */
export function turnCosts(events: { kind: string; payload: Record<string, unknown> }[]): Map<object, number> {
  const costs = new Map<object, number>();
  let last = 0;
  for (const e of events) {
    const total = e.payload.costCumulativeUsd;
    if (e.kind !== 'usage' || typeof total !== 'number') continue;
    if (total === 0) { costs.set(e.payload, 0); continue; }
    costs.set(e.payload, Math.round((total >= last ? total - last : total) * 1e10) / 1e10);
    last = total;
  }
  return costs;
}

/** Turns that report costUsd use it; other turns are estimated, then fall back to the turn's share of a reported running total; any other unpriced turn makes the dollar figure null. */
export function summarize(
  events: { kind: string; payload: Record<string, unknown> }[],
  model: string | null,
  table: PriceTable,
  pinned?: { price: Price; version: string },
  pinnedModel?: (model: string) => { price: Price; version: string } | undefined,
): CostSummary {
  const sum: CostSummary = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, usd: 0, source: 'none', priceVersion: null, model };
  const price = pinned?.price ?? priceFor(table, model);
  let reported = false; let estimated = false;
  const versions = new Set<string>();
  const turns = turnCosts(events);
  for (const e of events) {
    if (e.kind === 'turn_end') sum.turns++;
    if (e.kind !== 'usage') continue;
    const u = e.payload as Usage;
    const ownModel = u.model && normalizeModel(u.model) !== normalizeModel(model ?? '');
    const eventPin = ownModel ? pinnedModel?.(u.model!) : pinned;
    const eventPrice = ownModel ? eventPin?.price ?? priceFor(table, u.model) : price;
    sum.input += u.input ?? 0; sum.output += u.output ?? 0; sum.cacheRead += u.cacheRead ?? 0; sum.cacheWrite += u.cacheWrite ?? 0;
    if (typeof u.costUsd === 'number') { reported = true; if (sum.usd !== null) sum.usd += u.costUsd; }
    else if (eventPrice) {
      estimated = true; versions.add(eventPin?.version ?? table.version ?? 'unversioned');
      if (sum.usd !== null) sum.usd += costOf(u, eventPrice);
    }
    else if (turns.has(e.payload)) { reported = true; if (sum.usd !== null) sum.usd += turns.get(e.payload)!; }
    else sum.usd = null;
  }
  sum.source = estimated ? 'estimate' : reported ? 'reported' : 'none';
  if (sum.source === 'none' && sum.usd === 0) sum.usd = null;
  if (estimated) sum.priceVersion = versions.size > 1 ? 'mixed' : [...versions][0] ?? null;
  return sum;
}
