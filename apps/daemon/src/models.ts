import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter, Model } from '@ormicode/agent-core';
import { agentList, createAdapter } from './registry.ts';
import { ormicodeDir } from './socket.ts';

const CACHE_TTL_MS = 60 * 60_000;
const MODEL_TIMEOUT_MS = 20_000;

interface ListedModel {
  agent: string;
  transport: string;
  id: string;
  label: string;
  efforts: string[];
  available: boolean;
  reason?: string;
  cachedAt: number;
}

interface CacheEntry { cachedAt: number; models: ListedModel[] }
interface ModelCache { entries: Record<string, CacheEntry> }
interface AdapterPair { agent: string; transport: string; invalid?: string }

function cachePath(): string {
  const dir = join(ormicodeDir(), 'cache');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'models.json');
}

function readCache(path: string): ModelCache {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ModelCache;
    return parsed && parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries) ? parsed : { entries: {} };
  } catch { return { entries: {} }; }
}

function writeCache(path: string, cache: ModelCache): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(cache));
  renameSync(temp, path);
}

function cacheKey(agent: string, transport: string, version?: string): string {
  return `${agent}/${transport}${version ? `/${version}` : ''}`;
}

function validEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as CacheEntry;
  // Empty lists are not cached knowledge — the adapter may have been
  // unauthenticated or mid-install; the next call should probe again.
  return Number.isFinite(entry.cachedAt) && Array.isArray(entry.models) && entry.models.length > 0 && entry.models.every(model =>
    model && typeof model.agent === 'string' && typeof model.transport === 'string' &&
    typeof model.id === 'string' && typeof model.label === 'string' && Array.isArray(model.efforts) &&
    model.efforts.every(effort => typeof effort === 'string') && typeof model.available === 'boolean' &&
    Number.isFinite(model.cachedAt) && (model.reason === undefined || typeof model.reason === 'string'));
}

function lastEntry(cache: ModelCache, agent: string, transport: string, preferred?: string): CacheEntry | undefined {
  const exact = preferred ? cache.entries[preferred] : undefined;
  if (validEntry(exact)) return exact;
  const prefix = `${agent}/${transport}`;
  return Object.entries(cache.entries)
    .filter(([key, entry]) => (key === prefix || key.startsWith(`${prefix}/`)) && validEntry(entry))
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt)[0]?.[1];
}

function toListedModels(agent: string, transport: string, models: readonly Model[], cachedAt: number): ListedModel[] {
  return models.filter(model => typeof model.id === 'string' && model.id.length > 0).map(model => ({
    agent, transport, id: model.id, label: model.name ?? model.id,
    efforts: Array.isArray(model.efforts) ? [...model.efforts] : [],
    available: model.available ?? true,
    ...(model.reason !== undefined ? { reason: model.reason } : {}),
    cachedAt,
  }));
}

async function timedModels(adapter: AgentAdapter): Promise<readonly Model[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      adapter.models(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('models() timed out after 20 seconds')), MODEL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pairsFor(agent?: string, requestedTransport?: string): AdapterPair[] {
  const installed = agentList();
  if (agent) {
    const found = installed.find(item => item.vendor === agent);
    const transport = requestedTransport ?? found?.transports[0] ?? 'cli';
    if (!found) return [{ agent, transport, invalid: `unknown agent ${agent}` }];
    if (!found.transports.includes(transport)) return [{ agent, transport, invalid: `no adapter for ${agent}/${transport}` }];
    return [{ agent, transport }];
  }
  return installed.map(item => ({ agent: item.vendor, transport: item.transports[0]! }));
}

export async function listModels(body: { agent?: string; transport?: string; refresh?: boolean }): Promise<{ models: ListedModel[]; errors?: { agent: string; transport: string; message: string }[] }> {
  let path: string | undefined;
  let cache: ModelCache = { entries: {} };
  try { path = cachePath(); cache = readCache(path); } catch { /* Model discovery still works if the cache directory is unavailable. */ }
  const pairs = pairsFor(body.agent, body.transport);
  const errors: { agent: string; transport: string; message: string }[] = [];
  let cacheChanged = false;
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)) || 'model listing failed';
  const results = await Promise.all(pairs.map(async pair => {
    if (pair.invalid) {
      errors.push({ agent: pair.agent, transport: pair.transport, message: pair.invalid });
      return [] as ListedModel[];
    }
    let adapter: AgentAdapter | undefined;
    let version: string | undefined;
    try {
      adapter = await createAdapter(pair.agent, pair.transport, {});
      try { version = (await adapter.detect()).version; } catch { /* Some agents list models despite an unavailable version probe. */ }
      const key = cacheKey(pair.agent, pair.transport, version);
      const previous = lastEntry(cache, pair.agent, pair.transport, key);
      if (!body.refresh && previous && previous === cache.entries[key] && Date.now() - previous.cachedAt >= 0 && Date.now() - previous.cachedAt < CACHE_TTL_MS)
        return previous.models;
      try {
        const listed = toListedModels(pair.agent, pair.transport, await timedModels(adapter), Date.now());
        if (listed.length) {
          cache.entries[key] = { cachedAt: listed[0].cachedAt, models: listed };
          cacheChanged = true;
        }
        return listed;
      } catch (error) {
        const fallback = lastEntry(cache, pair.agent, pair.transport, key);
        if (fallback) return fallback.models;
        errors.push({ agent: pair.agent, transport: pair.transport, message: errorMessage(error) });
        return [] as ListedModel[];
      }
    } catch (error) {
      const fallback = lastEntry(cache, pair.agent, pair.transport);
      if (fallback) return fallback.models;
      errors.push({ agent: pair.agent, transport: pair.transport, message: errorMessage(error) });
      return [] as ListedModel[];
    }
  }));
  if (cacheChanged && path) {
    try { writeCache(path, cache); } catch { /* Return discovered models even if persisting the cache fails. */ }
  }
  return { models: results.flat(), ...(errors.length ? { errors } : {}) };
}
