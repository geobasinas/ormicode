import * as z from 'zod/mini';
import { requestIdSchema, timestampSchema } from './schema.ts';
import { sessionStateSchema } from './methods.ts';

const text = z.string();
const nonEmpty = z.string().check(z.minLength(1));
const count = z.number().check(z.int(), z.gte(0));
const quantity = z.number().check(z.gte(0));
export const eventBodies = {
  prompt: z.looseObject({ kind: z.literal('prompt'), text }),
  queue_changed: z.looseObject({
    kind: z.literal('queue_changed'),
    items: z.array(z.object({ id: nonEmpty, text: nonEmpty, createdAt: timestampSchema, images: z.optional(count), error: z.optional(text) })),
  }),
  turn_start: z.looseObject({ kind: z.literal('turn_start') }),
  turn_end: z.looseObject({ kind: z.literal('turn_end') }),
  text: z.looseObject({ kind: z.literal('text'), text }),
  thinking: z.looseObject({ kind: z.literal('thinking'), text }),
  plan: z.looseObject({ kind: z.literal('plan'), text }),
  tool_call: z.looseObject({ kind: z.literal('tool_call'), callId: nonEmpty, name: nonEmpty, input: z.json(), parent: z.optional(nonEmpty) }),
  tool_result: z.looseObject({ kind: z.literal('tool_result'), callId: nonEmpty, status: z.enum(['completed', 'failed', 'interrupted']), output: z.optional(z.json()), parent: z.optional(nonEmpty) }),
  approval_request: z.looseObject({ kind: z.literal('approval_request'), request: requestIdSchema, options: z.array(z.looseObject({ id: nonEmpty, label: text })), destructive: z.optional(z.boolean()), rule: z.optional(text), approvalKind: z.optional(nonEmpty), target: z.optional(z.json()), mode: z.optional(text), reason: z.optional(text), estimate: z.optional(z.json()) }),
  approval_decision: z.looseObject({ kind: z.literal('approval_decision'), request: requestIdSchema, option: nonEmpty }),
  question_request: z.looseObject({ kind: z.literal('question_request'), request: requestIdSchema, questions: z.array(z.looseObject({ question: nonEmpty, header: text, options: z.array(z.looseObject({ label: nonEmpty, description: text })), multiSelect: z.boolean() })) }),
  question_answer: z.looseObject({ kind: z.literal('question_answer'), request: requestIdSchema, answers: z.record(z.string(), z.string()) }),
  interaction_expired: z.looseObject({ kind: z.literal('interaction_expired'), request: requestIdSchema, reason: nonEmpty }),
  state: z.looseObject({ kind: z.literal('state'), state: sessionStateSchema, reason: z.optional(text) }),
  model_changed: z.looseObject({ kind: z.literal('model_changed'), model: nonEmpty }),
  effort_changed: z.looseObject({ kind: z.literal('effort_changed'), effort: nonEmpty }),
  mode_changed: z.looseObject({ kind: z.literal('mode_changed'), mode: nonEmpty }),
  config_option: z.looseObject({ kind: z.literal('config_option'), id: nonEmpty, value: z.union([z.string(), z.boolean()]) }),
  usage: z.looseObject({ kind: z.literal('usage'), input: z.optional(count), output: z.optional(count), cacheRead: z.optional(count), cacheWrite: z.optional(count), costUsd: z.optional(quantity) }),
  rate_limited: z.looseObject({ kind: z.literal('rate_limited'), attempt: count }),
  retry_scheduled: z.looseObject({ kind: z.literal('retry_scheduled'), delayMs: count }),
  permission_denied: z.looseObject({ kind: z.literal('permission_denied'), reason: z.optional(text) }),
  error: z.looseObject({ kind: z.literal('error'), code: nonEmpty, message: text }),
  interrupted: z.looseObject({ kind: z.literal('interrupted'), reason: nonEmpty }),
  resumed: z.looseObject({ kind: z.literal('resumed') }),
  workspace_step: z.looseObject({
    kind: z.literal('workspace_step'), step: z.enum(['fetch', 'create', 'copy_dirty', 'include', 'setup', 'resume', 'teardown']),
    status: z.enum(['ok', 'warn', 'skipped']), detail: z.optional(text), output: z.optional(text),
  }),
  service_state: z.looseObject({
    kind: z.literal('service_state'), service: nonEmpty,
    state: z.enum(['stopped', 'starting', 'running', 'unhealthy', 'exited']),
    port: count, code: z.optional(z.nullable(z.number())), detail: z.optional(text),
  }),
  // A restore point after a tool call (seq = the tool_result); overCap = bytes when one checkpoint alone exceeds the cap.
  checkpoint: z.looseObject({ kind: z.literal('checkpoint'), id: nonEmpty, seq: count, tool: text, overCap: z.optional(count) }),
  browser_action: z.looseObject({
    kind: z.literal('browser_action'), action: z.enum(['open', 'click', 'type', 'snapshot', 'screenshot', 'close']),
    target: z.optional(text), url: text, ok: z.boolean(), error: z.optional(text), artifact: z.optional(nonEmpty),
    actor: z.enum(['agent', 'user', 'auto']),
  }),
  checkpoint_screenshot: z.looseObject({
    kind: z.literal('checkpoint_screenshot'), checkpoint: nonEmpty, artifact: nonEmpty, url: text, actor: z.literal('auto'),
  }),
  checkpoint_restored: z.looseObject({ kind: z.literal('checkpoint_restored'), id: nonEmpty, mode: nonEmpty }),
  conversation_rewound: z.looseObject({ kind: z.literal('conversation_rewound'), to: count, checkpoint: nonEmpty }),
  renamed: z.looseObject({ kind: z.literal('renamed'), title: nonEmpty }),
  file_edit: z.looseObject({ kind: z.literal('file_edit'), path: nonEmpty, size: count, checkpoint: z.nullable(nonEmpty) }),
  handoff_brief: z.looseObject({ kind: z.literal('handoff_brief'), text }),
  handoff_started: z.looseObject({ kind: z.literal('handoff_started'), child: nonEmpty, target: nonEmpty, mode: nonEmpty }),
  handoff_continued: z.looseObject({ kind: z.literal('handoff_continued'), parent: nonEmpty, parentTitle: text }),
  handoff_failed: z.looseObject({ kind: z.literal('handoff_failed'), reason: nonEmpty }),
  evicted: z.looseObject({ kind: z.literal('evicted'), reason: nonEmpty, idleMs: count }),
  compacted: z.looseObject({ kind: z.literal('compacted') }),
  agent_version: z.looseObject({ kind: z.literal('agent_version'), version: nonEmpty }),
  text_delta: z.looseObject({ kind: z.literal('text_delta'), text }),
  thinking_delta: z.looseObject({ kind: z.literal('thinking_delta'), text }),
} as const;
export type ImplementedEvent = keyof typeof eventBodies;
export type AgentEvent = z.infer<(typeof eventBodies)[ImplementedEvent]>;

/** Validate only explicitly supported event bodies; unknown kinds are not accepted. */
export function parseEventBody(body: unknown) {
  if (typeof body !== 'object' || body === null || !('kind' in body) || typeof body.kind !== 'string') {
    return { success: false as const, error: 'protocol.invalid_frame' as const };
  }
  if (!Object.hasOwn(eventBodies, body.kind)) return { success: false as const, error: 'protocol.unknown_event' as const };
  const json = z.safeParse(z.json(), body);
  if (!json.success) return { success: false as const, error: 'protocol.invalid_frame' as const, issues: json.error.issues };
  const result = z.safeParse(eventBodies[body.kind as ImplementedEvent], json.data);
  return result.success
    ? { success: true as const, data: result.data }
    : { success: false as const, error: 'protocol.invalid_frame' as const, issues: result.error.issues };
}
