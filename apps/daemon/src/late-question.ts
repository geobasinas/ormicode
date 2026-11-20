import { addQueuedPrompt, getSession, pendingQuestions, type Store } from '@ormicode/session-store';
import { newId } from '@ormicode/protocol';
import type { Client, DispatchCtx } from './dispatch.ts';
import { handoffTargetError } from './handoff-transition.ts';

export function validQuestionAnswer(question: string, options: string[], answers: Record<string, string>): boolean {
  const answer = Object.hasOwn(answers, question) ? answers[question] : undefined;
  return Object.keys(answers).length === 1 && Boolean(answer?.trim()) && (!options.length || options.includes(answer!));
}

export function hasUnansweredUserQuestion(db: Store, session: string): boolean {
  return pendingQuestions(db, session, { daemonOnly: true }).length > 0;
}

export function lateQuestionAnswer(ctx: DispatchCtx, client: Client, id: string, session: string, request: string, answers: Record<string, string>): boolean {
  const row = ctx.db.prepare(`SELECT payload FROM events WHERE session = ? AND kind = 'question_request'
    AND json_extract(payload, '$.request') = ? AND json_extract(payload, '$.daemonInteraction') = 1 LIMIT 1`).get(session, request) as { payload: string } | undefined;
  if (!row) return false;
  const unavailable = handoffTargetError(ctx.db, session);
  if (unavailable) { client.link.replyError(id, 'session.busy', unavailable); return true; }
  const answered = ctx.db.prepare(`SELECT 1 FROM events WHERE session = ? AND kind = 'question_answer'
    AND json_extract(payload, '$.request') = ? LIMIT 1`).get(session, request);
  if (answered || !pendingQuestions(ctx.db, session, { daemonOnly: true }).includes(request)) {
    client.link.replyError(id, 'session.already_decided', 'question already answered or cancelled'); return true;
  }
  const question = (JSON.parse(row.payload) as { questions: { question: string; options: { label: string }[] }[] }).questions[0];
  if (!question || !validQuestionAnswer(question.question, question.options.map(o => o.label), answers)) {
    client.link.replyError(id, 'team.invalid', 'answer the offered question with one offered choice or non-empty text'); return true;
  }
  ctx.db.transaction(() => {
    addQueuedPrompt(ctx.db, session, { id: newId('q'), text: `User answer to question ${request}:\n${question.question}\n${answers[question.question]}`, createdAt: Date.now() });
    ctx.record(session, 'question_answer', { request, answers, actor: client.device, late: true, daemonInteraction: true });
  })();
  if (!getSession(ctx.db, session)?.archived) void ctx.drainQueue(session).catch(() => undefined);
  client.link.reply(id, { answered: true });
  return true;
}
