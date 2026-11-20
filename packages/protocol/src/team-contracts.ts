import * as z from 'zod/mini';
import { sessionIdSchema as session, idSchema, timestampSchema } from './schema.ts';

const text = z.string();
const nonEmpty = z.string().check(z.minLength(1));
const team = idSchema('t');
const target = { actor: session, session };
export const userQuestion = { question: nonEmpty, options: z.optional(z.array(nonEmpty).check(z.maxLength(20))) };
export const userAnswer = z.object({ request: idSchema('req'), answers: z.record(z.string(), text) });
const message = z.object({
  id: idSchema('q'), team, from_session: session, to_session: session, reply_to: z.nullable(idSchema('q')),
  body: text, urgent: z.number(), created_at: timestampSchema, read_at: z.nullable(timestampSchema),
});
const child = z.object({ session, state: text, parentless: z.optional(z.boolean()), lastActivity: timestampSchema, tokens: z.nullable(z.number()) });
export const teamRequests = {
  'team.askUser': z.object({ actor: session, ...userQuestion }),
  'team.openPr': z.object({ actor: session, session: z.optional(session), title: nonEmpty, body: text, base: z.optional(nonEmpty), draft: z.optional(z.boolean()) }),
  'team.approve': z.object({ ...target, request: idSchema('req'), option: nonEmpty, reason: nonEmpty }),
  'team.spawn': z.object({ actor: session, task: nonEmpty, vendor: z.optional(nonEmpty), transport: z.optional(nonEmpty), model: z.optional(nonEmpty), effort: z.optional(nonEmpty), mode: z.optional(nonEmpty), toolAllowlist: z.optional(z.array(nonEmpty)) }),
  'team.tree': z.object({ actor: session }),
  'team.status': z.object({ ...target, wake: z.optional(z.boolean()) }),
  'team.message': z.object({ actor: session, to: z.optional(session), replyTo: z.optional(idSchema('q')), text: nonEmpty, urgent: z.optional(z.boolean()) }),
  'team.inbox': z.object({ actor: session }),
  'team.board': z.object({ actor: session, action: z.enum(['read', 'append', 'setState']), text: z.optional(text) }),
  'team.cancel': z.object(target),
  'team.reassign': z.object({ ...target, task: nonEmpty }),
  'team.close': z.object(target),
  'team.diff': z.object(target),
  'team.report': z.object(target),
} as const;
export const teamResponses = {
  'team.askUser': userAnswer,
  'team.openPr': z.object({ number: z.number(), url: nonEmpty }),
  'team.approve': z.object({ decided: z.boolean() }),
  'team.spawn': z.object({ team, session }),
  'team.tree': z.object({ team, parent: session, children: z.array(child) }),
  'team.status': child,
  'team.message': z.object({ id: idSchema('q') }),
  'team.inbox': z.object({ messages: z.array(message) }),
  'team.board': z.object({ board: text }),
  'team.cancel': z.object({ interrupted: z.boolean() }),
  'team.reassign': z.object({ accepted: z.boolean() }),
  'team.close': z.object({ closed: z.boolean() }),
  'team.diff': z.object({ patch: text, files: z.array(z.looseObject({ path: text })), truncated: z.boolean() }),
  'team.report': z.object({ text }),
} as const;
