import { newId } from '@ormicode/protocol';
import { createSession, getSession, releaseSessionPorts, setState } from '@ormicode/session-store';
import { acquireWorkspace, releaseForSession } from '@ormicode/leases';
import { hasTransport } from './registry.ts';
import { handoffBrief } from './handoff.ts';
import { estimateHandoff } from './handoff-methods.ts';
import { removeWorktree, resolveWorkspace } from '@ormicode/git-core';
import type { Client, DispatchCtx } from './dispatch.ts';
import { allocateSessionPorts } from './session-ports.ts';
import { sessionEnvironment } from './session-env.ts';
import { runSessionHook } from './workspace-hooks.ts';

const pendingApprovals = new Map<string, { ctx: DispatchCtx; session: string; expire(reason: string): void; resolve(approved: boolean): void }>();

export function expireHandoffApprovals(ctx: DispatchCtx, session?: string, reason = 'session_unavailable'): boolean {
  let expired = false;
  for (const pending of pendingApprovals.values())
    if (pending.ctx === ctx && (session === undefined || pending.session === session)) { pending.expire(reason); expired = true; }
  return expired;
}

export function resolveHandoffApproval(ctx: DispatchCtx, session: string, request: string, option: string): boolean {
  const pending = pendingApprovals.get(request);
  if (pending?.ctx !== ctx || pending.session !== session) return false;
  pendingApprovals.delete(request);
  const approved = option === 'approve';
  pending.resolve(approved);
  ctx.record(session, 'approval_decision', { request, option: approved ? 'approve' : 'deny' });
  return true;
}

export async function handoffRequest(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>): Promise<void> {
  const session = String(body.session);
  const db = ctx.db;
  const s = getSession(db, session);
  if (!s) return client.link.replyError(id, 'session.not_found', session);
  const to = body.to as { vendor?: string; transport?: string; model?: string; effort?: string; branch?: string };
  const mode = String(body.mode);
  const reason = typeof body.reason === 'string' ? body.reason : undefined;
  const inTurn = ['running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited'].includes(s.state);
  if (inTurn && (ctx.handoffsInTurn.get(session) ?? 0) >= 1)
    return client.link.replyError(id, 'handoff.limit', 'one handoff per turn');
  const targetVendor = to.vendor ?? s.vendor;
  if (mode !== 'in_place') {
    let depth = 0;
    let cur = s.parent as string | null;
    while (cur) { depth++; cur = getSession(db, cur)?.parent ?? null; }
    if (depth >= 3) return client.link.replyError(id, 'handoff.limit', 'max handoffs per task');
    const parentRow = s.parent ? getSession(db, s.parent) : undefined;
    if (parentRow && parentRow.vendor === targetVendor && parentRow.vendor !== s.vendor)
      return client.link.replyError(id, 'handoff.bounce', `cannot hand back to ${targetVendor}`);
    if (!hasTransport(targetVendor, to.transport ?? s.transport))
      return client.link.replyError(id, 'agent.unsupported', `${targetVendor}/${to.transport ?? s.transport}`);
  }
  const estimate = estimateHandoff(ctx, session, to, mode, typeof body.brief === 'string' ? body.brief : undefined);
  if (estimate.confirmRequired && body.confirmed !== true) {
    if (body.agentApproval !== true)
      return client.link.replyError(id, 'handoff.confirm_required', JSON.stringify(estimate));
    const request = newId('req');
    const approved = await new Promise<boolean>(resolve => {
      const expire = (reason: string) => {
        pendingApprovals.delete(request);
        clearTimeout(timer);
        ctx.record(session, 'interaction_expired', { request, approvalKind: 'handoff', reason });
        const current = getSession(db, session);
        if (current && !current.archived && current.state === 'awaiting_approval')
          ctx.record(session, 'state', { state: reason === 'cancelled' ? 'interrupted' : s.state });
        resolve(false);
      };
      const timer = setTimeout(() => expire('timeout'), 10 * 60_000).unref();
      pendingApprovals.set(request, {
        ctx, session, expire,
        resolve: value => { clearTimeout(timer); resolve(value); },
      });
      ctx.record(session, 'approval_request', {
        request, approvalKind: 'handoff', target: to, mode, reason: reason ?? '', estimate,
        options: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny' }],
      });
    });
    if (!approved) return client.link.replyError(id, 'handoff.declined', 'The handoff was declined or expired');
  }
  if (mode === 'in_place') {
    for (const [kind, value] of [['model', to.model], ['effort', to.effort]] as const) {
      if (!value) continue;
      const res = await ctx.toWorker(session, 'worker.configure', { kind, value });
      if (res?.type === 'res') db.prepare(`UPDATE sessions SET ${kind} = ? WHERE id = ?`).run(value, session);
    }
    ctx.handoffsInTurn.set(session, (ctx.handoffsInTurn.get(session) ?? 0) + 1);
    return client.link.reply(id, { session: s.id, brief: '', parent: s.id });
  }
  const child = newId('s');
  let ports: { base: number; count: 10 };
  try { ports = await allocateSessionPorts(db, child); }
  catch (error) { return client.link.replyError(id, 'session.ports_unavailable', String(error)); }
  let resolved = { cwd: s.cwd, worktree: s.worktree ?? undefined, branch: s.branch ?? undefined, baseCommit: s.base_commit ?? undefined };
  if (mode === 'fork') {
    const name = to.branch ?? `handoff-${child.slice(-8)}`;
    let r;
    try {
      r = await resolveWorkspace(
        s.project, { kind: 'worktree', branch: s.branch ?? 'HEAD', name }, name, child, () => false,
        sessionEnvironment({ session: child, project: s.project, cwd: s.cwd, base: ports.base }),
      );
    } catch (error) {
      releaseSessionPorts(db, child);
      return client.link.replyError(id, 'workspace.failed', String(error));
    }
    if ('err' in r) {
      releaseSessionPorts(db, child);
      return client.link.replyError(id, r.err, r.detail ?? r.err);
    }
    resolved = { cwd: r.cwd, worktree: r.worktree, branch: r.branch, baseCommit: r.baseCommit };
  }
  const brief = typeof body.brief === 'string' && body.brief ? body.brief : handoffBrief(db, session);
  createSession(db, {
    id: child, machine: s.machine, project: s.project, vendor: targetVendor,
    transport: to.transport ?? s.transport, cwd: resolved.cwd,
    worktree: resolved.worktree, branch: resolved.branch, baseCommit: resolved.baseCommit,
    ...(to.model ?? s.model ? { model: String(to.model ?? s.model) } : {}),
    ...(to.effort ?? s.effort ? { effort: String(to.effort ?? s.effort) } : {}),
    ...(s.mode ? { mode: s.mode } : {}), title: s.title ?? undefined, parent: s.id,
  });
  const originalState = s.state;
  const readyMs = Number(process.env.ORMICODE_HANDOFF_READY_MS ?? 60_000);
  let parentStopped = false;
  try {
    ctx.spawnWorker(child);
    await ctx.ensureWorker(child, Number.isFinite(readyMs) && readyMs > 0 ? readyMs : 60_000);
    await ctx.stopWorker(session);
    parentStopped = true;
    setState(db, session, 'done');
    db.prepare('UPDATE sessions SET handed_off = 1 WHERE id = ?').run(session);
    const lease = acquireWorkspace(db, resolved.cwd, child, s.machine);
    if (lease.conflict) throw new Error(`workspace held by ${lease.conflict}`);
    const sent = await ctx.sendPrompt(child, `You are taking over this task${reason ? ` — ${reason}` : ''}. Handoff brief:\n${brief}\nContinue where the previous session left off.`, undefined, { journal: false });
    if (!sent) throw new Error('new worker rejected the handoff brief');
    ctx.record(session, 'handoff_started', { child, target: targetVendor, mode });
    ctx.record(child, 'handoff_continued', { parent: session, parentTitle: s.title ?? session });
    ctx.handoffsInTurn.set(session, (ctx.handoffsInTurn.get(session) ?? 0) + 1);
    return client.link.reply(id, { session: child, brief, parent: s.id });
  } catch (error) {
    const reasonText = error instanceof Error ? error.message : String(error);
    await ctx.stopWorker(child).catch(() => undefined);
    await ctx.services.stopSession(child);
    if (mode === 'fork' && resolved.worktree && resolved.branch) {
      const childRow = getSession(db, child);
      if (childRow) await runSessionHook(childRow, 'teardown', ports.base, ctx.record);
    }
    releaseForSession(db, child);
    for (const table of ['session_queue', 'pending_prompt_data', 'session_drafts', 'session_prices', 'device_cursors', 'outbox', 'events', 'tool_calls'])
      db.prepare(`DELETE FROM ${table} WHERE session = ?`).run(child);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(child);
    releaseSessionPorts(db, child);
    if (mode === 'fork' && resolved.worktree && resolved.branch) removeWorktree(s.project, resolved.worktree, resolved.branch);
    db.prepare('UPDATE sessions SET handed_off = 0, state = ?, worker_pid = NULL WHERE id = ?').run(originalState, session);
    let leaseMessage = reasonText;
    if (mode !== 'fork' && !db.prepare('SELECT 1 FROM leases WHERE path = ? AND session = ?').get(s.cwd, session)) {
      const lease = acquireWorkspace(db, s.cwd, session, s.machine);
      if (lease.conflict) leaseMessage = `${reasonText}; could not restore workspace lease held by ${lease.conflict}`;
    }
    if (parentStopped) try {
      ctx.spawnWorker(session);
      await ctx.ensureWorker(session, Number.isFinite(readyMs) && readyMs > 0 ? readyMs : 60_000);
    } catch { /* session remains recoverable */ }
    ctx.record(session, 'handoff_failed', { reason: leaseMessage });
    return client.link.replyError(id, 'handoff.failed', reasonText);
  }
}
