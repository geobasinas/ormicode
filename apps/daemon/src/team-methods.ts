import { newId } from '@ormicode/protocol';
import {
  addQueuedPrompt, addTeamMessage, archiveSession, closeTeam, getSession, getTeam, getTeamMessage, markTeamMessagesRead,
  ownedTeam, releaseSessionPorts, setState, teamChildren, unreadTeamMessages, type SessionRow, type TeamRow,
} from '@ormicode/session-store';
import { readBoard, teamPermission, writeBoard } from '@ormicode/team-core';
import { replay } from '@ormicode/journal';
import { diffPatch } from '@ormicode/git-core';
import { releaseForSession } from '@ormicode/leases';
import type { Client, DispatchCtx } from './dispatch.ts';
import { ormicodeDir } from './socket.ts';
import { spawnTeamChild } from './team-spawn.ts';
import { interrupt } from './team-interrupt.ts';
import { handoffTargetError } from './handoff-transition.ts';

const locks = new WeakMap<DispatchCtx, Promise<void>>();
export async function teamMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  if (method === 'team.askUser' || method === 'team.openPr' || method === 'team.status' && body.wake) return handle(ctx, client, id, method, body);
  const previous = locks.get(ctx) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => handle(ctx, client, id, method, body));
  locks.set(ctx, next);
  await next;
}
async function handle(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  const actor = getSession(ctx.db, String(body.actor));
  const fail = (code: string, message: string) => client.link.replyError(id, code, message);
  if (!actor) return fail('session.not_found', String(body.actor));
  const actorError = handoffTargetError(ctx.db, actor.id);
  if (actorError) return fail('team.invalid', actorError);
  if (actor.archived) return fail('team.closed', 'caller is archived');
  if (method === 'team.spawn') return spawnTeamChild(ctx, client, id, body, actor);
  const team = ownedTeam(ctx.db, actor.id) ?? (actor.team ? getTeam(ctx.db, actor.team) : undefined);
  if (!team) return fail('team.not_found', 'session has no team');
  if (team.closed_at !== null) return fail('team.closed', 'team is closed');
  const target = body.session === undefined ? undefined : getSession(ctx.db, String(body.session));
  if (!teamPermission(method, team.parent, actor.id, target?.id, String(body.action)))
    return fail('team.forbidden', 'only the team parent may perform this action (children may close only themselves)');
  if (body.session !== undefined && (!target || (target.team !== team.id && target.id !== team.parent)))
    return fail('team.not_member', 'target is not in this team');
  const targetError = target && handoffTargetError(ctx.db, target.id);
  if (targetError && !['team.diff', 'team.report'].includes(method) && !(method === 'team.status' && !body.wake))
    return fail('team.invalid', targetError);
  const reply = (result: Record<string, unknown>) => client.link.reply(id, result);
  switch (method) {
    case 'team.askUser': return ctx.interactions.ask(client, id, actor.id, body);
    case 'team.openPr': return ctx.interactions.openPr(client, id, actor.id, target?.id ?? actor.id, body);
    case 'team.approve': return ctx.teamApprovals.approve(client, id, body);
    case 'team.escalate': return ctx.teamApprovals.escalate(client, id, body);
    case 'team.tree': return reply({ team: team.id, parent: team.parent, children: teamChildren(ctx.db, team.id).map(s => status(ctx, s)) });
    case 'team.status':
      if (body.wake && !target!.archived) await ctx.ensureWorker(target!.id);
      return reply(status(ctx, getSession(ctx.db, target!.id)!));
    case 'team.inbox': {
      const messages = unreadTeamMessages(ctx.db, actor.id).filter(m => m.team === team.id);
      markTeamMessagesRead(ctx.db, messages.map(m => m.id));
      return reply({ messages });
    }
    case 'team.message': return message(ctx, client, id, body, actor, team);
    case 'team.board': {
      const action = String(body.action);
      if (action === 'read') return reply({ board: readBoard(ormicodeDir(), team.id) });
      if (typeof body.text !== 'string') return fail('team.invalid', 'text is required for a board write');
      const board = writeBoard(ormicodeDir(), team.id, actor.id, team.parent, action as 'append' | 'setState', body.text);
      ctx.record(team.parent, 'board_entry', { team: team.id, actor: actor.id, action, text: body.text });
      return reply({ board });
    }
    case 'team.cancel':
    case 'team.reassign': {
      if (target!.id === team.parent || target!.archived) return fail('team.invalid', 'target must be a live child');
      await interrupt(ctx, target!.id, { cancelHandoffs: true });
      if (method === 'team.cancel') return reply({ interrupted: true });
      addQueuedPrompt(ctx.db, target!.id, { id: newId('q'), text: String(body.task), createdAt: Date.now() });
      await ctx.drainQueue(target!.id);
      return reply({ accepted: true });
    }
    case 'team.close': {
      const children = target!.id === team.parent ? teamChildren(ctx.db, team.id) : [target!];
      for (const child of children) {
        await ctx.stopWorker(child.id);
        await ctx.agentBrowser.closeSession(child.id);
        await ctx.services.stopSession(child.id);
        archiveSession(ctx.db, child.id); setState(ctx.db, child.id, 'archived');
        releaseForSession(ctx.db, child.id); releaseSessionPorts(ctx.db, child.id);
      }
      if (target!.id === team.parent) { closeTeam(ctx.db, team.id); ctx.teamApprovals.unavailable(team.parent); }
      return reply({ closed: true });
    }
    case 'team.diff': {
      if (!target!.base_commit) return fail('git.failed', 'child has no recorded base commit');
      const { patch, files } = diffPatch(target!.cwd, target!.base_commit);
      return reply({ patch: patch.slice(0, 256 * 1024), files, truncated: patch.length > 256 * 1024 });
    }
    case 'team.report': {
      const events = replay(ctx.db, target!.id).filter(e => e.kind === 'text');
      return reply({ text: events.length ? String(JSON.parse(events.at(-1)!.payload).text ?? '') : '' });
    }
  }
}
function status(ctx: DispatchCtx, session: SessionRow): Record<string, unknown> {
  const usage = replay(ctx.db, session.id).filter(e => e.kind === 'usage');
  const tokens = usage.length ? usage.reduce((sum, event) => {
    const payload = JSON.parse(event.payload) as { input?: number; output?: number };
    return sum + (payload.input ?? 0) + (payload.output ?? 0);
  }, 0) : null;
  return { session: session.id, state: ctx.teamApprovals.waiting(session.id) ? 'awaiting_approval' : session.state, parentless: Boolean(session.parentless), lastActivity: session.updated_at, tokens };
}
async function message(ctx: DispatchCtx, client: Client, id: string, body: Record<string, unknown>, actor: SessionRow, team: TeamRow): Promise<void> {
  const original = body.replyTo ? getTeamMessage(ctx.db, String(body.replyTo)) : undefined;
  if (body.replyTo && (!original || original.team !== team.id || original.to_session !== actor.id))
    return client.link.replyError(id, 'team.invalid', 'reply must reference a message sent to this session');
  const to = String(body.to ?? original?.from_session ?? '');
  if (original && body.to && body.to !== original.from_session)
    return client.link.replyError(id, 'team.invalid', 'reply recipient must be the original sender');
  const recipient = getSession(ctx.db, to);
  const toUser = Boolean(actor.parentless) && to === team.parent;
  if (!recipient || recipient.archived && !toUser || (recipient.team !== team.id && recipient.id !== team.parent))
    return client.link.replyError(id, 'team.not_member', 'recipient is not a live member of this team');
  const recipientError = handoffTargetError(ctx.db, to);
  if (recipientError) return client.link.replyError(id, 'team.invalid', recipientError);
  const messageId = newId('q');
  addTeamMessage(ctx.db, { id: messageId, team: team.id, from_session: actor.id, to_session: to,
    reply_to: original?.id ?? null, body: String(body.text), urgent: body.urgent ? 1 : 0, created_at: Date.now() });
  if (toUser) {
    ctx.teamLifecycle.toUser({ id: messageId, team: team.id, from_session: actor.id, to_session: to,
      reply_to: original?.id ?? null, body: String(body.text), urgent: body.urgent ? 1 : 0, created_at: Date.now() });
    return client.link.reply(id, { id: messageId });
  }
  const event = { team: team.id, from: actor.id, to, message: messageId };
  ctx.record(actor.id, 'team_message', event);
  if (to !== actor.id) ctx.record(to, 'team_message', event);
  if (actor.id !== team.parent && to !== team.parent) ctx.record(team.parent, 'team_message', { ...event, quiet: true, text: `${actor.id} → ${to}` });
  if (body.urgent) await interrupt(ctx, to);
  if (['idle', 'done', 'interrupted'].includes(getSession(ctx.db, to)!.state)) {
    addQueuedPrompt(ctx.db, to, { id: newId('q'), text: 'New team message.', createdAt: Date.now() });
    await ctx.drainQueue(to);
  }
  client.link.reply(id, { id: messageId });
}
