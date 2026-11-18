// OpenRouter models API (https://openrouter.ai/api/v1/models, no key needed):
// pricing fields are USD per token as strings; we store USD per million.
import { createHash } from 'node:crypto';
import { normalizeModel, type Price, type PriceTable } from './table.ts';

export const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';

interface OrModel { id: string; canonical_slug?: string; pricing?: Record<string, string | undefined> }

const perMillion = (v: string | undefined) => {
  const n = Number(v);
  return v === undefined || !Number.isFinite(n) || n < 0 ? undefined : Math.round(n * 1e6 * 1e6) / 1e6;
};

export function fromOpenRouter(body: unknown): PriceTable {
  const data = (body as { data?: OrModel[] })?.data;
  if (!Array.isArray(data)) throw new Error('unexpected OpenRouter response');
  const models: Record<string, Price> = {};
  for (const m of data) {
    // `:batch`, `:free` etc. are discounted variants, not the list price.
    if (typeof m.id !== 'string' || m.id.includes(':') || !m.pricing) continue;
    const input = perMillion(m.pricing.prompt); const output = perMillion(m.pricing.completion);
    if (input === undefined || output === undefined || input < 0 || (input === 0 && output === 0)) continue;
    const cacheRead = perMillion(m.pricing.input_cache_read); const cacheWrite = perMillion(m.pricing.input_cache_write);
    const price: Price = { input, output, ...(cacheRead !== undefined ? { cacheRead } : {}), ...(cacheWrite !== undefined ? { cacheWrite } : {}) };
    for (const key of new Set([m.id, m.canonical_slug].filter((k): k is string => typeof k === 'string').map(normalizeModel))) models[key] ??= price;
  }
  const hash = createHash('sha256').update(JSON.stringify(Object.entries(models).sort())).digest('hex').slice(0, 8);
  return { version: `openrouter-${hash}`, models };
}

export async function fetchOpenRouter(url = OPENROUTER_MODELS, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<PriceTable> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`);
  return fromOpenRouter(await res.json());
}
