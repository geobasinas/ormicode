import { setTimeout } from 'node:timers/promises';
import { addQueuedPrompt, getSession, getTeam, listQueuedPrompts, ownedTeam, settingValue, teamChildren, unreadTeamMessages } from '@ormicode/session-store';
import { teamLimits } from '@ormicode/team-core';
import { newId } from '@ormicode/protocol';
import type { DispatchCtx } from './dispatch.ts';
import { handoffTargetError } from './handoff-transition.ts';

const busy = ['starting', 'running', 'retrying', 'awaiting_input', 'awaiting_approval'];
const reservations = new WeakMap<DispatchCtx, Set<string>>();

export async function beforeWorkerResume(ctx: DispatchCtx, session: string, stopped = () => false): Promise<(() => void) | undefined> {
  if (stopped()) throw new Error('daemon is closing');
  const row = getSession(ctx.db, session), team = row?.team ? getTeam(ctx.db, row.team) : undefined;
  if (!team || team.parent === session) return;
  if (team.closed_at !== null || row?.archived) throw new Error('team.closed: child is closed');
  const parent = getSession(ctx.db, team.parent);
  if (parent && !parent.archived && parent.state !== 'failed' && !handoffTargetError(ctx.db, parent.id)) await ctx.ensureWorker(parent.id);
  if (stopped()) throw new Error('daemon is closing');
  const reserved = reservations.get(ctx) ?? new Set<string>();
  reservations.set(ctx, reserved);
  const deadline = Date.now() + 30_000;
  while (teamChildren(ctx.db, team.id).filter(s => s.id !== session && !s.archived && (busy.includes(s.state) || reserved.has(s.id))).length
    >= teamLimits(key => settingValue(ctx.db, key)).concurrent) {
    if (Date.now() >= deadline) throw new Error('team.limit: timed out waiting for a child resume slot');
    await setTimeout(25);
    if (stopped()) throw new Error('daemon is closing');
    if (getSession(ctx.db, session)?.archived || getTeam(ctx.db, team.id)?.closed_at !== null) throw new Error('team.closed: child is closed');
  }
  reserved.add(session);
  return () => { reserved.delete(session); };
}

export function resumeQueuedChildren(ctx: DispatchCtx, parent: string): void {
  const team = ownedTeam(ctx.db, parent);
  if (!team || team.closed_at !== null || getSession(ctx.db, parent)?.archived) return;
  for (const child of teamChildren(ctx.db, team.id)) {
    if (child.archived || child.state === 'paused_rate_limited' || handoffTargetError(ctx.db, child.id)) continue;
    if (!listQueuedPrompts(ctx.db, child.id).length && unreadTeamMessages(ctx.db, child.id).length)
      addQueuedPrompt(ctx.db, child.id, { id: newId('q'), text: 'Resume and read your team inbox.', createdAt: Date.now() });
    if (listQueuedPrompts(ctx.db, child.id).length) void ctx.drainQueue(child.id).catch(() => undefined);
  }
}

export async function resumeSession(ctx: DispatchCtx, session: string): Promise<boolean> {
  const row = getSession(ctx.db, session);
  const unavailable = handoffTargetError(ctx.db, session);
  if (unavailable) throw new Error(unavailable);
  if (!row || row.archived) throw new Error('session is unavailable');
  ctx.paused.delete(session);
  await ctx.ensureWorker(session);
  ctx.teamLifecycle.available(session);
  if (!await ctx.drainQueue(session)) return false;
  resumeQueuedChildren(ctx, session);
  return true;
}

export function workerReadiness(options: {
  ready(session: string): boolean; exists(session: string): boolean; pending(session: string): boolean;
  spawn(session: string): void; failure(session: string): Error | undefined;
  before(session: string): Promise<(() => void) | undefined>;
  closed(): boolean;
}) {
  const starting = new Map<string, Promise<void>>();
  return (session: string, timeoutMs = 30_000): Promise<void> => {
    if (options.ready(session)) return Promise.resolve();
    const existing = starting.get(session);
    if (existing) return existing;
    const next = (async () => {
      const release = await options.before(session);
      try {
        if (options.closed()) throw new Error('daemon is closing');
        if (!options.exists(session)) options.spawn(session);
        const deadline = Date.now() + timeoutMs;
        while (!options.ready(session)) {
          if (options.closed()) throw new Error('daemon is closing');
          const failure = options.failure(session);
          if (failure) throw failure;
          if (!options.exists(session) && !options.pending(session)) throw new Error('worker exited before ready');
          if (Date.now() >= deadline) throw new Error('worker.ready timeout');
          await setTimeout(25);
        }
      } finally { release?.(); }
    })().finally(() => starting.delete(session));
    starting.set(session, next);
    return next;
  };
}
