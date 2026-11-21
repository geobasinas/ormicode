// Session-list rows for sessions that live on paired nodes. The hub keeps
// only the summaries nodes push — remote rows merge into session.list/idx
// and flip to 'unreachable' when the machine stops heartbeating.
import { DiffStatCache } from '@ormicode/git-core';
import { getSessionPorts, listSessions } from '@ormicode/session-store';
import { SESSION_PORT_COUNT } from './session-ports.ts';
import { sessionStatus } from './session-status.ts';
import { sessionTeamView } from './session-team-view.ts';
import type { Client, DispatchCtx } from './dispatch.ts';

const diffStats = new DiffStatCache();

/** The machine a remote-only session id lives on, if any. */
export function remoteSessionMachine(ctx: DispatchCtx, session: string): string | undefined {
  // ctx.remoteSessions is absent in tests that fake a minimal context.
  for (const [machine, remote] of ctx.remoteSessions ?? [])
    if (remote.sessions.some(s => s.id === session)) return machine;
  return undefined;
}

/** Summary rows for every session on every known node. */
export function remoteSessionRows(ctx: DispatchCtx): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [machine, remote] of ctx.remoteSessions ?? [])
    for (const s of remote.sessions)
      rows.push({ ...s, remote: true, machine, state: ctx.machineUnreachable(machine) ? 'unreachable' : String(s.state ?? 'idle') });
  return rows;
}

export function sessionListMethod(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>): void {
  const { db } = ctx;
  const sessions = listSessions(db, Boolean(body.archived)).filter(s => !s.deleted).map(s => {
    const base = getSessionPorts(db, s.id);
    return {
      id: s.id, title: s.title, state: sessionStatus(ctx, s).state, parentless: Boolean(s.parentless), project: s.project, vendor: s.vendor,
      transport: s.transport, updatedAt: s.updated_at, branch: s.branch,
      worktree: Boolean(s.worktree), ...sessionTeamView(db, s), delegatedApproval: ctx.teamApprovals.delegatedOnly(s.id),
      ...(base === undefined ? {} : { ports: { base, count: SESSION_PORT_COUNT } }),
      ...(s.base_commit && !s.archived ? { diff: diffStats.get(s.cwd, s.base_commit) } : {}),
      remote: false, machine: 'm_local',
    };
  });
  if (!body.archived) sessions.push(...remoteSessionRows(ctx) as never[]);
  client.link.reply(id, { sessions });
}
