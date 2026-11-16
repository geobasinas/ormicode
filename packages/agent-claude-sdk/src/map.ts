import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

export interface MappedMessage { events: AgentEvent[]; nativeId?: string }

/** Convert documented SDK messages to protocol events. No credentials or process are touched. */
export function mapSdkMessage(message: SDKMessage, options: { forwardSubagentText?: boolean } = {}): MappedMessage {
  const candidates: unknown[] = [];
  const parent = 'parent_tool_use_id' in message && message.parent_tool_use_id
    ? { parent: message.parent_tool_use_id } : {};
  const canForwardText = !('parent_tool_use_id' in message && message.parent_tool_use_id) || options.forwardSubagentText === true;
  if (message.type === 'system' && message.subtype === 'init') {
    candidates.push({ kind: 'agent_version', version: message.claude_code_version });
    return { events: validate(candidates), nativeId: message.session_id };
  }
  if (message.type === 'assistant') {
    if (message.error) candidates.push({ kind: 'error', code: mapError(message.error), message: message.error });
    for (const block of message.message.content) {
      if (block.type === 'text' && canForwardText) candidates.push({ kind: 'text', text: block.text, ...parent });
      else if (block.type === 'thinking' && canForwardText) candidates.push({ kind: 'thinking', text: block.thinking, ...parent });
      else if (block.type === 'tool_use') candidates.push({ kind: 'tool_call', callId: block.id, name: block.name, input: block.input, ...parent });
    }
  } else if (message.type === 'user' && Array.isArray(message.message.content)) {
    for (const block of message.message.content) {
      if (block.type === 'tool_result') {
        candidates.push({ kind: 'tool_result', callId: block.tool_use_id, status: block.is_error ? 'failed' : 'completed', ...(block.content === undefined ? {} : { output: block.content }), ...parent });
      }
    }
  } else if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && canForwardText) {
    const delta = message.event.delta;
    if (delta.type === 'text_delta') candidates.push({ kind: 'text_delta', text: delta.text, ...parent });
    else if (delta.type === 'thinking_delta') candidates.push({ kind: 'thinking_delta', text: delta.thinking, ...parent });
  } else if (message.type === 'result') {
    const usage = message.usage;
    candidates.push({ kind: 'usage', input: usage.input_tokens, output: usage.output_tokens, ...(usage.cache_read_input_tokens == null ? {} : { cacheRead: usage.cache_read_input_tokens }), ...(usage.cache_creation_input_tokens == null ? {} : { cacheWrite: usage.cache_creation_input_tokens }), costCumulativeUsd: message.total_cost_usd });
    if (message.subtype !== 'success') candidates.push({ kind: 'error', code: message.subtype === 'error_max_budget_usd' ? 'plan_limit' : 'unknown', message: message.errors.join('\n') });
    candidates.push({ kind: 'turn_end' });
  } else if (message.type === 'system' && message.subtype === 'api_retry' && (message.error === 'rate_limit' || message.error === 'overloaded')) {
    candidates.push({ kind: 'rate_limited', attempt: message.attempt }, { kind: 'retry_scheduled', delayMs: message.retry_delay_ms });
  }
  return { events: validate(candidates) };
}

function validate(candidates: unknown[]): AgentEvent[] {
  return candidates.map((event) => {
    const parsed = parseEventBody(event);
    if (!parsed.success) throw new Error(`Invalid mapped Claude event: ${parsed.error}`);
    return parsed.data;
  });
}
function mapError(error: string): string {
  if (error === 'rate_limit') return 'rate_limited';
  if (error === 'overloaded') return 'overloaded';
  if (error === 'authentication_failed' || error === 'oauth_org_not_allowed' || error === 'cloud_credential_error') return 'auth';
  return 'unknown';
}
