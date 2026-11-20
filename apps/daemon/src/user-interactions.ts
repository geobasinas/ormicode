import { newId } from '@ormicode/protocol';
import { getSession, getTeam, ownedTeam, type SessionState } from '@ormicode/session-store';
import { preparePr, publishPr, type PreparedPr } from '@ormicode/git-core';
import type { Client, DispatchCtx } from './dispatch.ts';
import { lateQuestionAnswer, validQuestionAnswer } from './late-question.ts';
import { handoffTargetError } from './handoff-transition.ts';

type Body = Record<string, unknown>;
type Pending = {
  session: string; target?: string; previous: SessionState; kind: 'question' | 'pr';
  resolve(value: Body | undefined): void; done: boolean; question?: string; options?: string[];
  timer?: NodeJS.Timeout;
};

export class UserInteractions {
  private readonly context: () => DispatchCtx;
  private readonly pending = new Map<string, Pending>();
  private closed = false;
  constructor(context: () => DispatchCtx) { this.context = context; }

  private begin(session: string, kind: Pending['kind'], payload: Body, extra: Partial<Pending> = {}): { request: string; answer: Promise<Body | undefined> } {
    const ctx = this.context(), row = getSession(ctx.db, session);
    if (!row || row.archived || this.closed) throw new Error('session is unavailable');
    if ([...this.pending.values()].some(p => !p.done && p.session === session)
      || ['awaiting_approval', 'awaiting_input'].includes(row.state)) throw new Error('session already has a pending interaction');
    const request = newId('req');
    const answer = new Promise<Body | undefined>(resolve => {
      const pending: Pending = { session, previous: row.state, kind, resolve, done: false, ...extra };
      pending.timer = setTimeout(() => this.finish(request, pending, 'interaction_expired', { reason: 'timeout' }), 10 * 60_000).unref();
      this.pending.set(request, pending);
      ctx.record(session, kind === 'question' ? 'question_request' : 'approval_request', { ...payload, request, daemonInteraction: true, userOnly: true });
    });
    return { request, answer };
  }
  private finish(request: string, pending: Pending, kind: string, payload: Body, result?: Body): void {
    const ctx = this.context();
    pending.done = true;
    clearTimeout(pending.timer);
    this.pending.delete(request);
    ctx.record(pending.session, kind, { request, ...payload, ...(kind === 'interaction_expired' && pending.kind === 'question' ? { answerable: !['handed_off', 'user_abort'].includes(String(payload.reason)) } : {}), daemonInteraction: true });
    const row = getSession(ctx.db, pending.session);
    if (row && !row.archived && ['awaiting_approval', 'awaiting_input', 'running'].includes(row.state))
      ctx.record(row.id, 'state', { state: pending.previous });
    pending.resolve(result);
  }
  async ask(client: Client, id: string, session: string, body: Body): Promise<void> {
    const ctx = this.context(), row = getSession(ctx.db, session);
    if (!row) return client.link.replyError(id, 'session.not_found', session);
    const team = ownedTeam(ctx.db, session) ?? (row.team ? getTeam(ctx.db, row.team) : undefined);
    if (team && team.parent !== session) return client.link.replyError(id, 'team.forbidden', 'only the team parent may ask the user');
    const question = String(body.question).trim(), options = (body.options ?? []) as string[];
    if (!question || options.some(o => !o.trim()) || new Set(options).size !== options.length)
      return client.link.replyError(id, 'team.invalid', 'question and choices must be non-empty; choices must be unique');
    const { request, answer } = this.begin(session, 'question', {
      questions: [{ question, header: 'Agent question', options: options.map(label => ({ label, description: '' })), multiSelect: false }],
    }, { question, options });
    const answers = await answer;
    if (!answers) return client.link.replyError(id, 'agent.failed', 'question expired or the session became unavailable');
    client.link.reply(id, { request, answers });
  }
  async openPr(client: Client, id: string, actor: string, target: string, body: Body): Promise<void> {
    const ctx = this.context(), row = getSession(ctx.db, target);
    if (!row || row.archived) return client.link.replyError(id, 'team.closed', 'PR source is unavailable');
    if (target !== actor && ['starting', 'running', 'retrying', 'awaiting_input', 'awaiting_approval'].includes(row.state))
      return client.link.replyError(id, 'checkpoint.busy', 'stop the child before opening its PR');
    let prepared: PreparedPr;
    try { prepared = preparePr(row.cwd, typeof body.base === 'string' ? body.base : row.base_branch); }
    catch (error) { return client.link.replyError(id, 'git.failed', String(error instanceof Error ? error.message : error)); }
    if (!String(body.title).trim()) return client.link.replyError(id, 'team.invalid', 'PR title is required');
    const { request, answer } = this.begin(actor, 'pr', {
      approvalKind: 'team_open_pr', tool: 'Push branch and open PR',
      description: `Push ${prepared.head} on ${prepared.branch} to ${prepared.remote} and open a PR against ${prepared.base}.`,
      input: { ...prepared, title: body.title, body: body.body, draft: Boolean(body.draft), session: target },
      options: [{ id: 'approve', label: 'Approve once' }, { id: 'deny', label: 'Deny' }],
    }, { target });
    const decision = await answer;
    if (!decision || decision.option !== 'approve') return client.link.replyError(id, 'git.confirm_required', 'PR publication was denied or expired; nothing was pushed');
    try {
      const current = getSession(ctx.db, target);
      if (!current || current.archived || (target !== actor && ['starting', 'running', 'retrying', 'awaiting_input', 'awaiting_approval'].includes(current.state)))
        throw new Error('PR source became unavailable or busy; request a new approval');
      const result = publishPr(prepared, String(body.title), String(body.body), Boolean(body.draft));
      ctx.record(actor, 'team_pr_result', { request, session: target, ...result, branch: prepared.branch, head: prepared.head });
      client.link.reply(id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.record(actor, 'team_pr_result', { request, session: target, error: message, branch: prepared.branch, head: prepared.head });
      client.link.replyError(id, 'git.failed', `${message}. If push succeeded, it is not rolled back; request approval again to retry.`);
    }
  }
  private find(session: string, request: string): Pending | undefined { return [...this.pending].find(([r, p]) => r === request && p.session === session)?.[1]; }
  private known(session: string, request: string): boolean {
    return Boolean(this.context().db.prepare(`SELECT 1 FROM events WHERE session = ? AND kind IN ('question_request','approval_request')
      AND json_extract(payload, '$.request') = ? AND json_extract(payload, '$.daemonInteraction') = 1 LIMIT 1`).get(session, request));
  }
  async method(client: Client, id: string, method: string, body: Body): Promise<void> {
    const ctx = this.context(), session = String(body.session), request = String(body.request);
    const unavailable = handoffTargetError(ctx.db, session);
    if (unavailable) return client.link.replyError(id, 'session.busy', unavailable);
    if (method === 'session.askUser') return this.ask(client, id, session, body);
    const pending = this.find(session, request);
    if (!pending && method === 'session.answer' && lateQuestionAnswer(ctx, client, id, session, request, body.answers as Record<string, string>)) return;
    if (!pending && !this.known(session, request)) {
      if (method === 'session.decide') return ctx.teamApprovals.userDecision(client, id, body);
      if (await ctx.teamLifecycle.answer(client, id, body)) return;
      const res = await ctx.toWorker(session, 'worker.answer', { request, answers: body.answers });
      return res?.type === 'res' ? client.link.reply(id, { answered: true }) : client.link.replyError(id, 'agent.unsupported', 'answer');
    }
    if (!pending || pending.done) return client.link.replyError(id, 'session.already_decided', 'interaction already answered or expired');
    if (pending.kind === 'question' && method === 'session.answer') {
      const answers = body.answers as Record<string, string>;
      if (!validQuestionAnswer(pending.question!, pending.options ?? [], answers))
        return client.link.replyError(id, 'team.invalid', 'answer the offered question with one offered choice or non-empty text');
      this.finish(request, pending, 'question_answer', { answers, actor: client.device }, answers);
      return client.link.reply(id, { answered: true });
    }
    if (pending.kind === 'pr' && method === 'session.decide') {
      if (!['approve', 'deny'].includes(String(body.option))) return client.link.replyError(id, 'team.invalid', 'choose approve or deny once');
      this.finish(request, pending, 'approval_decision', { option: body.option, actor: client.device, parentDecided: false }, { option: body.option });
      return client.link.reply(id, { decided: true });
    }
    client.link.replyError(id, 'team.invalid', 'wrong interaction response method');
  }
  unavailable(session: string, reason = 'session_unavailable'): void {
    if (this.closed) return;
    for (const [request, pending] of this.pending)
      if (!pending.done && (pending.session === session || pending.target === session)) this.finish(request, pending, 'interaction_expired', { reason });
  }
  close(): void {
    for (const [request, pending] of this.pending) if (!pending.done) this.finish(request, pending, 'interaction_expired', { reason: 'daemon_shutdown' });
    this.closed = true;
  }
}
