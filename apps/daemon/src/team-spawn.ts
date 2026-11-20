import { newId } from '@ormicode/protocol';
import { activeTeamCount, archiveSession, closeTeam, createTeam, getSession, getTeam, ownedTeam, releaseSessionPorts, settingValue, setSessionTeam, setState, teamChildren, type SessionRow } from '@ormicode/session-store';
import { releaseForSession } from '@ormicode/leases';
import { readBoard, spawnLimit, teamLimits } from '@ormicode/team-core';
import type { Client, DispatchCtx } from './dispatch.ts';
import { startSession } from './session-start.ts';
import { ormicodeDir } from './socket.ts';

export async function spawnTeamChild(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>, parent: SessionRow): Promise<void> {
  if (parent.archived) return client.link.replyError(id, 'team.closed', 'parent is archived');
  if (body.toolAllowlist !== undefined) return client.link.replyError(id, 'agent.unsupported', 'per-child tool allowlists are not supported by the adapter contract');
  const existing = ownedTeam(ctx.db, parent.id);
  let depth = 1;
  let ancestor = parent;
  const seen = new Set([parent.id]);
  while (ancestor.parent) {
    if (seen.has(ancestor.parent)) return client.link.replyError(id, 'team.limit', 'parent cycle');
    seen.add(ancestor.parent);
    const next = getSession(ctx.db, ancestor.parent);
    if (!next) break;
    depth++; ancestor = next;
  }
  if (parent.team && getTeam(ctx.db, parent.team)?.parent !== parent.id)
    return client.link.replyError(id, 'team.forbidden', 'only the team parent can spawn children');
  const children = existing ? teamChildren(ctx.db, existing.id).filter(s => !s.archived) : [];
  const limit = spawnLimit(teamLimits(key => settingValue(ctx.db, key)), {
    children: children.length, running: children.filter(s => ['starting', 'running', 'retrying', 'awaiting_approval', 'awaiting_input'].includes(s.state)).length,
    depth, teams: activeTeamCount(ctx.db), newTeam: !existing,
  });
  if (limit) return client.link.replyError(id, 'team.limit', limit);
  const team = existing ?? { id: newId('t'), parent: parent.id, project: parent.project };
  if (!existing) {
    createTeam(ctx.db, team);
    setSessionTeam(ctx.db, parent.id, team.id);
  }
  let child: string | undefined;
  let failed = false;
  const capture: Client = { ...client, link: {
    ...client.link,
    reply: (_id, result) => { child = String(result.session); },
    replyError: (_id, code, message) => { failed = true; client.link.replyError(id, code, message); },
  } };
  try {
    await startSession(ctx, capture, id, {
      machine: parent.machine, project: parent.project, vendor: body.vendor ?? parent.vendor, transport: body.transport ?? parent.transport,
      model: body.model ?? parent.model ?? 'default', effort: body.effort ?? parent.effort ?? 'default', mode: body.mode ?? parent.mode ?? 'default',
      ...(!body.vendor && parent.agent_command ? { agentCommand: parent.agent_command } : {}),
      ...(!body.vendor && parent.agent_args ? { agentArgs: JSON.parse(parent.agent_args) } : {}),
      workspace: { kind: 'worktree', branch: parent.branch ?? parent.base_commit ?? 'HEAD', name: `ormi-${newId('s').slice(2)}` }, parent: parent.id, team: team.id,
    });
    if (!child || failed) { if (!existing) closeTeam(ctx.db, team.id); return; }
    ctx.record(parent.id, 'agent_spawned', { team: team.id, child });
    readBoard(ormicodeDir(), team.id);
    const sent = await ctx.sendPrompt(child, `${String(body.task)}\n\nA shared team board exists. Use the team tools to read it, record findings and communicate with your team.`);
    if (!sent) throw new Error('child rejected its task prompt');
    client.link.reply(id, { team: team.id, session: child });
  } catch (error) {
    if (child) {
      await ctx.stopWorker(child);
      archiveSession(ctx.db, child); setState(ctx.db, child, 'archived');
      releaseForSession(ctx.db, child); releaseSessionPorts(ctx.db, child);
    }
    if (!existing) closeTeam(ctx.db, team.id);
    if (!failed) client.link.replyError(id, 'team.failed', error instanceof Error ? error.message : String(error));
  }
}
