import { getPinnedPrice, getSession, listSessions, pinPrice, type SessionRow, type Store } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';
import { costOf, normalizeModel, priceFor, summarize, type CostSummary, type Price, type PriceTable, type Usage } from '@ormicode/pricing';
import type { Client, DispatchCtx } from './dispatch.ts';

interface CostEvent { ts: number; kind: string; payload: Record<string, unknown> }
interface Bucket { tokens: number; usd: number | null; unpriced: number; estimate: boolean }

function eventsFor(db: Store, session: string): CostEvent[] {
  return replay(db, session).map(e => ({ ts: e.ts, kind: e.kind, payload: JSON.parse(e.payload) as Record<string, unknown> }));
}

function priceForSession(db: Store, session: SessionRow, events: CostEvent[], table: PriceTable) {
  const estimated = events.filter(e => e.kind === 'usage' && typeof e.payload.costUsd !== 'number');
  if (estimated.length) for (const model of new Set([session.model, ...estimated.map(e => e.payload.model)])) {
    if (typeof model !== 'string' || !model || getPinnedPrice(db, session.id, model)) continue;
    const price = priceFor(table, model);
    if (price) pinPrice(db, session.id, model, price, table.version ?? 'unversioned');
  }
  return session.model ? getPinnedPrice(db, session.id, session.model) : undefined;
}

function emptyBucket(): Bucket { return { tokens: 0, usd: null, unpriced: 0, estimate: false }; }

function addUsage(bucket: Bucket, event: CostEvent, price: Price | undefined): void {
  const usage = event.payload as Usage;
  bucket.tokens += (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  if (typeof usage.costUsd === 'number') bucket.usd = (bucket.usd ?? 0) + usage.costUsd;
  else if (price) {
    bucket.usd = (bucket.usd ?? 0) + costOf(usage, price);
    bucket.estimate = true;
  } else bucket.unpriced++;
}

function localDate(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function insert<K>(map: Map<K, Bucket>, key: K): Bucket {
  let bucket = map.get(key);
  if (!bucket) { bucket = emptyBucket(); map.set(key, bucket); }
  return bucket;
}

function sessionCost(db: Store, session: SessionRow, events: CostEvent[], table: PriceTable): CostSummary {
  const pinned = priceForSession(db, session, events, table);
  return summarize(events.filter(e => e.kind === 'usage' || e.kind === 'turn_end'), session.model, table, pinned,
    model => getPinnedPrice(db, session.id, model));
}

export async function costMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  if (method === 'session.cost') {
    const sessionId = String(body.session);
    const session = getSession(ctx.db, sessionId);
    if (!session) return client.link.replyError(id, 'session.not_found', sessionId);
    await ctx.prices.ensure();
    return client.link.reply(id, { ...sessionCost(ctx.db, session, eventsFor(ctx.db, sessionId), ctx.prices.table()) });
  }
  if (method !== 'cost.totals') return client.link.replyError(id, 'protocol.unimplemented', method);

  await ctx.prices.ensure();
  const table = ctx.prices.table();
  const since = typeof body.since === 'number' ? body.since : undefined;
  const total = emptyBucket();
  const projects = new Map<string, Bucket>(); const days = new Map<string, Bucket>();
  const sessions: { session: string; project: string; tokens: number; usd: number | null; unpriced: number; estimate: boolean }[] = [];
  for (const session of [...listSessions(ctx.db), ...listSessions(ctx.db, true)]) {
    const events = eventsFor(ctx.db, session.id);
    const usageEvents = events.filter(e => e.kind === 'usage');
    if (!usageEvents.length) continue;
    const pinned = priceForSession(ctx.db, session, events, table);
    const price = pinned?.price ?? priceFor(table, session.model);
    const inRange = usageEvents.filter(e => since === undefined || e.ts >= since);
    if (!inRange.length) continue;
    const sessionBucket = emptyBucket();
    for (const event of inRange) {
      const model = typeof event.payload.model === 'string' ? event.payload.model : session.model;
      const eventPrice = model && normalizeModel(model) !== normalizeModel(session.model ?? '')
        ? getPinnedPrice(ctx.db, session.id, model)?.price ?? priceFor(table, model) : price;
      addUsage(total, event, eventPrice);
      addUsage(insert(projects, session.project), event, eventPrice);
      addUsage(insert(days, localDate(event.ts)), event, eventPrice);
      addUsage(sessionBucket, event, eventPrice);
    }
    sessions.push({ session: session.id, project: session.project, ...sessionBucket });
  }
  return client.link.reply(id, {
    total,
    projects: [...projects].sort(([a], [b]) => a.localeCompare(b)).map(([project, bucket]) => ({ project, ...bucket })),
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, bucket]) => ({ date, ...bucket })),
    sessions: sessions.sort((a, b) => a.session.localeCompare(b.session)),
  });
}
