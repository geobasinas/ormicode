import { replay } from '@ormicode/journal';
import { getSession } from '@ormicode/session-store';
import { DiffStatCache } from '@ormicode/git-core';
import { priceFor } from '@ormicode/pricing';
import type { Client, DispatchCtx } from './dispatch.ts';
import { handoffBrief } from './handoff.ts';

const diffStats = new DiffStatCache();
export interface HandoffEstimate {
  briefTokens: number; contextTokens: number; filesChanged: number;
  usd: number | null; confirmUsd: number; confirmRequired: boolean;
}

function confirmUsd(): number {
  const value = Number(process.env.ORMICODE_HANDOFF_CONFIRM_USD ?? 1);
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

function contextTokens(ctx: DispatchCtx, session: string): number {
  const events = replay(ctx.db, session);
  let start = -1;
  for (let i = 0; i < events.length; i++) if (events[i]!.kind === 'turn_start') start = i;
  const afterStart = start < 0 ? [] : events.slice(start + 1);
  const end = afterStart.findIndex(event => event.kind === 'turn_end');
  const recent = end < 0 ? afterStart : afterStart.slice(0, end);
  return recent.reduce((sum, event) => {
    if (event.kind !== 'usage') return sum;
    const payload = JSON.parse(event.payload) as Record<string, unknown>;
    return sum + (typeof payload.input === 'number' ? payload.input : 0);
  }, 0);
}

export async function handoffMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  if (method === 'session.handoffBrief') return client.link.reply(id, { brief: handoffBrief(ctx.db, session) });
  if (method !== 'session.handoffEstimate') return client.link.replyError(id, 'protocol.unimplemented', method);
  return client.link.reply(id, { ...estimateHandoff(ctx, session, body.to as { model?: string } | undefined, String(body.mode), typeof body.brief === 'string' ? body.brief : undefined) });
}

export function estimateHandoff(ctx: DispatchCtx, session: string, to: { model?: string } | undefined, mode: string, customBrief?: string): HandoffEstimate {
  const row = getSession(ctx.db, session);
  if (!row) throw new Error(`unknown session ${session}`);
  const brief = customBrief || handoffBrief(ctx.db, session);
  const briefTokens = Math.ceil(brief.length / 4);
  const inputTokens = contextTokens(ctx, session);
  const model = to?.model ?? row.model;
  const price = mode === 'in_place' ? undefined : priceFor(ctx.prices.table(), model);
  const usd = mode === 'in_place' ? 0 : price ? (briefTokens + inputTokens) * price.input / 1_000_000 : null;
  const threshold = confirmUsd();
  return {
    briefTokens, contextTokens: inputTokens,
    filesChanged: row.base_commit ? diffStats.get(row.cwd, row.base_commit)?.files ?? 0 : 0,
    usd, confirmUsd: threshold,
    confirmRequired: mode !== 'in_place' && (usd === null || usd > threshold),
  };
}
