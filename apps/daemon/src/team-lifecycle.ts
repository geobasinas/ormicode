import { newId } from '@ormicode/protocol';
import {
  addQueuedPrompt, addTeamMessage, addTeamUserMessage, answerTeamUserMessage, getSession, getTeam,
  getTeamUserMessage, hasTeamUserMessages, listSessions, setChildrenParentless, settingValue,
  type SessionRow, type TeamMessage,
} from '@ormicode/session-store';
import type { Client, DispatchCtx } from './dispatch.ts';

export function silenceInterval(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 600_000;
}

export class TeamLifecycle {
  private readonly context: () => DispatchCtx;
  private readonly live: (session: string) => boolean;
  private readonly activity = new Map<string, { at: number; nudged: boolean }>();
  private timer?: NodeJS.Timeout;
  private closed = false;

  constructor(context: () => DispatchCtx, live: (session: string) => boolean) {
    this.context = context;
    this.live = live;
  }
  start(): void {
    for (const session of listSessions(this.context().db)) {
      if (session.parent && session.team && !this.live(session.parent)) this.unavailable(session.parent);
    }
    const poll = () => {
      this.check();
      this.timer = setTimeout(poll, Math.min(1000, this.interval())).unref();
    };
    this.timer = setTimeout(poll, Math.min(1000, this.interval())).unref();
  }
  close(): void { this.closed = true; clearTimeout(this.timer); this.timer = undefined; this.activity.clear(); }
  private interval(): number { return silenceInterval(settingValue(this.context().db, 'team.silenceMs')); }

  available(parent: string): void {
    if (this.closed) return;
    const ctx = this.context();
    const row = getSession(ctx.db, parent);
    if (!row || row.archived || row.handed_off || !this.live(parent)) return;
    if (row.parent && row.team) {
      const owner = getSession(ctx.db, row.parent);
      if (!owner || owner.archived || owner.handed_off || ['failed', 'interrupted'].includes(owner.state) || !this.live(owner.id)) this.unavailable(row.parent);
    }
    for (const child of setChildrenParentless(ctx.db, parent, false))
      ctx.record(child, 'team_parent_changed', { parent, parentless: false });
  }
  unavailable(parent: string): void {
    if (this.closed) return;
    const ctx = this.context();
    for (const child of setChildrenParentless(ctx.db, parent, true))
      ctx.record(child, 'team_parent_changed', { parent, parentless: true });
    ctx.teamApprovals.unavailable(parent);
  }
  event(session: string, kind: string, payload: Record<string, unknown>, now = Date.now()): void {
    if (this.closed) return;
    if (kind !== 'team_parent_changed' && !payload.nudge) this.activity.set(session, { at: now, nudged: false });
    if (['error', 'interrupted', 'evicted'].includes(kind)
      || kind === 'state' && ['failed', 'interrupted', 'archived'].includes(String(payload.state))) this.unavailable(session);
    if (kind === 'turn_start' || kind === 'ready') this.available(session);
  }
  check(now = Date.now()): void {
    if (this.closed) return;
    const ctx = this.context();
    const interval = this.interval();
    for (const session of listSessions(ctx.db)) {
      if (!session.team || !session.parent || session.state !== 'running' || !this.live(session.id)) continue;
      const team = getTeam(ctx.db, session.team);
      if (!team || team.closed_at !== null || team.parent === session.id) continue;
      let activity = this.activity.get(session.id);
      if (!activity) { activity = { at: now, nudged: false }; this.activity.set(session.id, activity); }
      if (activity.nudged || now - activity.at < interval) continue;
      activity.nudged = true;
      const message = {
        id: newId('q'), team: team.id, from_session: session.id, to_session: team.parent,
        reply_to: null, body: `Child ${session.id} has had no new events for ${interval} ms. Check its status or cancel if needed; it has not been stopped.`,
        urgent: 0, created_at: now,
      };
      addTeamMessage(ctx.db, message);
      if (session.parentless) this.toUser(message, true);
      else {
        ctx.record(session.id, 'team_message', { team: team.id, from: session.id, to: team.parent, message: message.id, nudge: true });
        ctx.record(team.parent, 'team_message', { team: team.id, from: session.id, to: team.parent, message: message.id, nudge: true });
        if (['idle', 'done', 'interrupted'].includes(getSession(ctx.db, team.parent)?.state ?? '')) {
          addQueuedPrompt(ctx.db, team.parent, { id: newId('q'), text: 'A silent child needs a status check. Read the team inbox.', createdAt: now });
          void ctx.drainQueue(team.parent).then(ok => { if (!ok) this.unavailable(team.parent); }).catch(() => this.unavailable(team.parent));
        }
      }
    }
  }
  toUser(message: Omit<TeamMessage, 'read_at'>, nudge = false): void {
    const ctx = this.context();
    const request = newId('req');
    addTeamUserMessage(ctx.db, request, message.id);
    ctx.record(message.from_session, 'team_message', {
      team: message.team, from: message.from_session, to: message.to_session, message: message.id, toUser: true, nudge,
    });
    ctx.record(message.from_session, 'question_request', {
      request, teamMessage: message.id, nudge,
      questions: [{ question: message.body, header: 'Parentless team message', options: [{ label: 'Acknowledge', description: 'Let the child know you saw this message.' }], multiSelect: false }],
    });
  }
  state(session: SessionRow): string {
    return session.team && !session.archived && hasTeamUserMessages(this.context().db, session.id) ? 'awaiting_input' : session.state;
  }
  async answer(client: Client, id: string, body: Record<string, unknown>): Promise<boolean> {
    const ctx = this.context();
    const session = String(body.session), request = String(body.request);
    const message = getTeamUserMessage(ctx.db, session, request);
    if (!message) return false;
    if (message.answered_at !== null) client.link.replyError(id, 'session.already_decided', 'message already answered');
    else {
      const text = Object.values(body.answers as Record<string, string>).join('\n').trim();
      if (!text) { client.link.replyError(id, 'team.invalid', 'a reply is required'); return true; }
      ctx.db.transaction(() => {
        answerTeamUserMessage(ctx.db, request);
        addQueuedPrompt(ctx.db, session, { id: newId('q'), text: `User reply to team message ${message.message}:\n${text}`, createdAt: Date.now() });
      })();
      ctx.record(session, 'question_answer', { request, answers: body.answers, actor: client.device, teamMessage: message.message });
      void ctx.drainQueue(session).catch(() => undefined);
      client.link.reply(id, { answered: true });
    }
    return true;
  }
}
