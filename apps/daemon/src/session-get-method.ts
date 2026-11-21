import { getSession, getSessionPorts, sessionConfig } from '@ormicode/session-store';
import { sessionStatus } from './session-status.ts';
import { sessionTeamView } from './session-team-view.ts';
import { remoteSessionMachine } from './remote-sessions.ts';
import { countScratchFiles } from './scratch-methods.ts';
import { SESSION_PORT_COUNT } from './session-ports.ts';
import type { Client, DispatchCtx } from './dispatch.ts';

/** session.get: full details for one session, including the vendor-advertised modes/config options from its worker. */
export function sessionGetMethod(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>): void {
  const { db } = ctx;
  const s = getSession(db, String(body.session));
  if (!s) {
    const machine = remoteSessionMachine(ctx, String(body.session));
    return machine
      ? client.link.replyError(id, 'machine.unreachable', machine)
      : client.link.replyError(id, 'session.not_found', String(body.session));
  }
  const base = getSessionPorts(db, s.id);
  const config = sessionConfig(s);
  return client.link.reply(id, {
    id: s.id, title: s.title, ...sessionStatus(ctx, s), lastSeq: s.last_seq, parentless: Boolean(s.parentless), project: s.project, vendor: s.vendor,
    cwd: s.cwd, ...(s.project === 'scratch' ? { scratchFiles: countScratchFiles(s.cwd) } : {}),
    transport: s.transport, updatedAt: s.updated_at, branch: s.branch, worktree: Boolean(s.worktree),
    ...(base === undefined ? {} : { ports: { base, count: SESSION_PORT_COUNT } }),
    model: s.model, effort: s.effort, mode: s.mode,
    nativeId: s.native_id, acpVersion: s.acp_version,
    ...(config?.options ? { options: config.options } : {}), ...(config?.modes ? { modes: config.modes } : {}),
    ...sessionTeamView(db, s), teamApprovals: ctx.teamApprovals.forParent(s.id),
  });
}
