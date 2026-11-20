import * as z from 'zod/mini';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

const record = z.record(z.string(), z.json());
const common = z.looseObject({ type: z.string() });
const init = z.looseObject({ type: z.literal('system'), subtype: z.literal('init'), session_id: z.string(), claude_code_version: z.string() });
const retry = z.looseObject({ type: z.literal('system'), subtype: z.literal('api_retry'), attempt: z.number(), retry_delay_ms: z.number(), error: z.string() });
const denied = z.looseObject({ type: z.literal('system'), subtype: z.literal('permission_denied'), message: z.string() });
const assistant = z.looseObject({ type: z.literal('assistant'), parent_tool_use_id: z.nullable(z.string()), message: z.looseObject({ model: z.optional(z.string()), content: z.array(record) }) });
const user = z.looseObject({ type: z.literal('user'), parent_tool_use_id: z.nullable(z.string()), message: z.looseObject({ content: z.union([z.string(), z.array(record)]) }) });
const partial = z.looseObject({ type: z.literal('stream_event'), parent_tool_use_id: z.nullable(z.string()), event: record });
const result = z.looseObject({ type: z.literal('result'), subtype: z.string(), usage: z.looseObject({ input_tokens: z.number(), output_tokens: z.number(), cache_read_input_tokens: z.optional(z.nullable(z.number())), cache_creation_input_tokens: z.optional(z.nullable(z.number())) }), total_cost_usd: z.number(), modelUsage: z.optional(record), errors: z.optional(z.array(z.string())) });

export interface CliMappedMessage { events: AgentEvent[]; nativeId?: string; result?: 'success' | 'error'; model?: string }

/** Parse a documented CLI JSON message; unknown message types are ignored. `model` is the last main-loop assistant model. */
export function mapCliMessage(value: unknown, options: { model?: string } = {}): CliMappedMessage {
  const header = z.parse(common, value);
  const out: unknown[] = [];
  let nativeId: string | undefined;
  let resultStatus: 'success' | 'error' | undefined;
  let model: string | undefined;
  if (header.type === 'system' && header.subtype === 'init') {
    const m = z.parse(init, value);
    nativeId = m.session_id;
    out.push({ kind: 'agent_version', version: m.claude_code_version });
  } else if (header.type === 'system' && header.subtype === 'permission_denied') {
    const m = z.parse(denied, value); out.push({ kind: 'permission_denied', reason: m.message });
  } else if (header.type === 'system' && header.subtype === 'api_retry') {
    const m = z.parse(retry, value);
    if (m.error === 'rate_limit' || m.error === 'overloaded') out.push({ kind: 'rate_limited', attempt: m.attempt }, { kind: 'retry_scheduled', delayMs: m.retry_delay_ms });
  } else if (header.type === 'assistant') {
    const m = z.parse(assistant, value);
    if (typeof m.error === 'string') {
      const code = m.error === 'rate_limit' ? 'rate_limited' : m.error === 'overloaded' ? 'overloaded' : ['authentication_failed', 'oauth_org_not_allowed', 'cloud_credential_error'].includes(m.error) ? 'auth' : 'unknown';
      out.push({ kind: 'error', code, message: m.error });
    }
    const parent = m.parent_tool_use_id ? { parent: m.parent_tool_use_id } : {};
    if (!m.parent_tool_use_id && m.message.model && m.message.model !== '<synthetic>') model = m.message.model;
    for (const block of m.message.content) {
      if (block.type === 'text' && !m.parent_tool_use_id) out.push({ kind: 'text', text: block.text });
      if (block.type === 'thinking' && !m.parent_tool_use_id) out.push({ kind: 'thinking', text: block.thinking });
      if (block.type === 'tool_use') out.push({ kind: 'tool_call', callId: block.id, name: block.name, input: block.input, ...parent });
    }
  } else if (header.type === 'user') {
    const m = z.parse(user, value);
    if (Array.isArray(m.message.content)) for (const block of m.message.content) {
      if (block.type === 'tool_result') out.push({ kind: 'tool_result', callId: block.tool_use_id, status: block.is_error ? 'failed' : 'completed', ...(block.content === undefined ? {} : { output: block.content }), ...(m.parent_tool_use_id ? { parent: m.parent_tool_use_id } : {}) });
    }
  } else if (header.type === 'stream_event') {
    const m = z.parse(partial, value);
    if (!m.parent_tool_use_id && m.event.type === 'content_block_delta') {
      const delta = m.event.delta;
      if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
        if (delta.type === 'text_delta') out.push({ kind: 'text_delta', text: delta.text });
        if (delta.type === 'thinking_delta') out.push({ kind: 'thinking_delta', text: delta.thinking });
      }
    }
  } else if (header.type === 'result') {
    const m = z.parse(result, value); resultStatus = m.subtype === 'success' ? 'success' : 'error';
    const models = Object.keys(m.modelUsage ?? {});
    const usageModel = options.model ?? (models.length === 1 ? models[0] : undefined);
    out.push({ kind: 'usage', ...(usageModel ? { model: usageModel } : {}), input: m.usage.input_tokens, output: m.usage.output_tokens, ...(m.usage.cache_read_input_tokens == null ? {} : { cacheRead: m.usage.cache_read_input_tokens }), ...(m.usage.cache_creation_input_tokens == null ? {} : { cacheWrite: m.usage.cache_creation_input_tokens }), costCumulativeUsd: m.total_cost_usd });
    if (m.subtype !== 'success') out.push({ kind: 'error', code: m.subtype === 'error_max_budget_usd' ? 'plan_limit' : 'unknown', message: m.errors?.join('\n') ?? m.subtype });
  }
  const events = out.map((event) => {
    const parsed = parseEventBody(event);
    if (!parsed.success) throw new Error(`Invalid Claude CLI event: ${parsed.error}`);
    return parsed.data;
  });
  return { events, ...(nativeId ? { nativeId } : {}), ...(resultStatus ? { result: resultStatus } : {}), ...(model ? { model } : {}) };
}
