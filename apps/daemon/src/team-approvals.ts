import { join } from 'node:path';
import { classifyCommand, loadDestructivePatterns } from '@ormicode/agent-core';
import { newId } from '@ormicode/protocol';
import { addQueuedPrompt, addTeamMessage, getSession, getTeam } from '@ormicode/session-store';
import type { Client, DispatchCtx } from './dispatch.ts';
import { resolveHandoffApproval } from './handoff-dispatch.ts';
import { ormicodeDir } from './socket.ts';
import { APPROVAL_GUIDANCE } from './team-guidance.ts';

type Payload = Record<string, unknown>;
type Pending = { session: string; parent: string; payload: Payload; options: Payload[]; decision?: { actor: string; reason: string } };
const key = (session: string, request: unknown) => `${session}/${String(request)}`;

export function onceOptions(payload: Payload): Payload[] {
  if (!Array.isArray(payload.options)) return [];
  if (new Set(payload.options.map(option => option?.id)).size !== payload.options.length) return [];
  return payload.options.filter((option): option is Payload => {
    if (!option || typeof option !== 'object' || typeof option.id !== 'string' || typeof option.label !== 'string') return false;
    if (/always|session|remember|permanent|workspace|project|for all/i.test(`${option.id} ${option.label}`)) return false;
    if (option.kind !== undefined) return option.kind === 'allow_once' || option.kind === 'reject_once';
    return /^(allow|deny|approve|reject)([ _-]once)?$/i.test(option.id)
      || /^(allow|deny|approve|reject)( once| this time)?$/i.test(option.label);
  });
}

export class TeamApprovals {
  private readonly pending = new Map<string, Pending>();
  private readonly userAnswers = new Map<string, string>();
  private readonly context: () => DispatchCtx;
  private readonly hasWorker: (session: string) => boolean;
  constructor(context: () => DispatchCtx, hasWorker: (session: string) => boolean) {
    this.context = context; this.hasWorker = hasWorker;
  }
  private available(session: string): boolean {
    const ctx = this.context(), parent = getSession(ctx.db, session);
    return Boolean(parent && !parent.archived && !parent.handed_off && this.hasWorker(session));
  }
  private destructive(payload: Payload): boolean {
    if (payload.destructive === true) return true;
    const patterns = loadDestructivePatterns(join(ormicodeDir(), 'destructive.json'));
    const walk = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value).some(([name, item]) => name === 'command' && typeof item === 'string'
        ? Boolean(classifyCommand(item, patterns)) : walk(item));
    };
    return walk(payload);
  }
  waiting(session: string): boolean { return [...this.pending.values()].some(p => p.session === session); }
  forParent(parent: string): Payload[] {
    return [...this.pending.values()].filter(p => p.parent === parent && !p.decision).map(p => ({
      session: p.session, request: p.payload.request, tool: p.payload.tool ?? 'Tool', input: p.payload.input,
      options: p.options.map(o => ({ id: o.id, label: o.label })),
    }));
  }
  event(session: string, kind: string, payload: Payload): [string, Payload] {
    const ctx = this.context(), id = key(session, payload.request), pending = this.pending.get(id);
    if (['approval_decision', 'interaction_expired'].includes(kind)) {
      const user = this.userAnswers.get(id); this.userAnswers.delete(id);
      this.pending.delete(id);
      if (kind === 'approval_decision' && pending?.decision)
        return [kind, { ...payload, ...pending.decision, parentDecided: true }];
      if (kind === 'approval_decision' && user) return [kind, { ...payload, actor: user, parentDecided: false }];
    }
    if (kind !== 'approval_request') return [kind, payload];
    if (this.destructive(payload)) { this.pending.delete(id); return [kind, { ...payload, destructive: true }]; }
    if (payload.userOnly === true) return [kind, payload];
    const child = getSession(ctx.db, session), team = child?.team ? getTeam(ctx.db, child.team) : undefined;
    const options = onceOptions(payload);
    if (!child || child.archived || child.parentless || !team || team.closed_at !== null || team.parent === session || child.parent !== team.parent
      || !this.available(team.parent) || !options.length) return [kind, payload];
    this.pending.set(id, { session, parent: team.parent, payload, options });
    const message = newId('q');
    addTeamMessage(ctx.db, { id: message, team: team.id, from_session: session, to_session: team.parent,
      reply_to: null, urgent: 0, created_at: Date.now(), body: JSON.stringify({ kind: 'approval', session, ...payload, options,
        instruction: APPROVAL_GUIDANCE }) });
    ctx.record(team.parent, 'team_message', { team: team.id, from: session, to: team.parent, message, approval: payload.request });
    if (['idle', 'done', 'interrupted'].includes(getSession(ctx.db, team.parent)!.state)) {
      addQueuedPrompt(ctx.db, team.parent, { id: newId('q'), text: `A child needs an approval. Read the team inbox. ${APPROVAL_GUIDANCE}`, createdAt: Date.now() });
      void ctx.drainQueue(team.parent).then(delivered => { if (!delivered) this.unavailable(team.parent); }).catch(() => this.unavailable(team.parent));
    }
    return ['team_approval_request', { ...payload, parent: team.parent, options }];
  }
  unavailable(session: string): void {
    const ctx = this.context();
    for (const id of this.userAnswers.keys()) if (id.startsWith(`${session}/`)) this.userAnswers.delete(id);
    for (const [id, pending] of this.pending) {
      if (pending.session === session) { this.pending.delete(id); continue; }
      if (pending.parent !== session || pending.decision) continue;
      this.toUser(pending, { fallbackReason: 'parent_unavailable' });
    }
  }
  private toUser(pending: Pending, payload: Payload): void {
    this.pending.delete(key(pending.session, pending.payload.request));
    this.context().record(pending.session, 'approval_request', { ...pending.payload, ...payload, userOnly: true });
  }
  escalate(client: Client, id: string, body: Payload): void {
    const pending = this.pending.get(key(String(body.session), body.request));
    if (!pending || pending.decision) return client.link.replyError(id, 'session.already_decided', 'approval is not pending for this parent');
    if (pending.parent !== body.actor) return client.link.replyError(id, 'team.forbidden', 'only the approval parent may escalate');
    if (!this.available(pending.parent)) { this.unavailable(pending.parent); return client.link.replyError(id, 'team.forbidden', 'parent is unavailable; approval returned to user'); }
    this.toUser(pending, { escalatedBy: pending.parent, ...(body.reason !== undefined ? { escalationReason: body.reason } : {}) });
    client.link.reply(id, { escalated: true });
  }
  async approve(client: Client, id: string, body: Payload): Promise<void> {
    const ctx = this.context(), session = String(body.session), request = String(body.request);
    const pending = this.pending.get(key(session, request));
    const fail = (code: string, message: string) => client.link.replyError(id, code, message);
    if (!pending || pending.decision) return fail('session.already_decided', 'approval is not pending for this parent');
    if (pending.parent !== body.actor) return fail('team.forbidden', 'only the approval parent may answer');
    if (!this.available(pending.parent)) { this.unavailable(pending.parent); return fail('team.forbidden', 'parent is unavailable; approval returned to user'); }
    if (!pending.options.some(option => option.id === body.option)) return fail('team.invalid', 'choose an offered once-only option; always/session choices are forbidden');
    pending.decision = { actor: pending.parent, reason: String(body.reason) };
    try {
      if (!resolveHandoffApproval(ctx, session, request, String(body.option))) {
        const response = await ctx.toWorker(session, 'worker.decide', { request, option: body.option });
        if (response?.type !== 'res') throw new Error('child rejected the approval decision');
      }
      client.link.reply(id, { decided: true });
    } catch {
      pending.decision = undefined;
      if (!this.available(pending.parent)) this.unavailable(pending.parent);
      fail('agent.failed', 'child could not accept the approval decision');
    }
  }
  async userDecision(client: Client, id: string, body: Payload): Promise<void> {
    const ctx = this.context(), session = String(body.session), request = String(body.request);
    if (this.pending.has(key(session, request))) return client.link.replyError(id, 'team.forbidden', 'approval is delegated to the parent');
    const decision = key(session, request); this.userAnswers.set(decision, client.device);
    let accepted = false;
    try {
      if (resolveHandoffApproval(ctx, session, request, String(body.option))) {
        accepted = true; return client.link.reply(id, { decided: true });
      }
      const response = await ctx.toWorker(session, 'worker.decide', { request, option: body.option });
      accepted = response?.type === 'res';
      return accepted ? client.link.reply(id, { decided: true }) : client.link.replyError(id, 'agent.unsupported', 'decide');
    } finally { if (!accepted) this.userAnswers.delete(decision); }
  }
}
