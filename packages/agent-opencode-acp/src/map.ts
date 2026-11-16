import * as z from 'zod/mini';
import type { AgentEvent } from '@ormicode/protocol';
import { parseEventBody } from '@ormicode/protocol';

const envelope = z.looseObject({ sessionId: z.string(), update: z.looseObject({ sessionUpdate: z.string() }) });
const chunk = z.looseObject({ content: z.looseObject({ type: z.string(), text: z.optional(z.string()) }) });
const tool = z.looseObject({ toolCallId: z.string().check(z.minLength(1)), title: z.optional(z.nullable(z.string())), status: z.optional(z.nullable(z.string())), rawInput: z.optional(z.json()), rawOutput: z.optional(z.json()) });

/** Maps one OpenCode ACP turn, retaining text and tool state until the prompt ends. */
export class OpenCodeTurnMapper {
  private text = '';
  private thinking = '';
  private readonly calls = new Set<string>();
  private readonly finished = new Set<string>();
  private readonly sessionId: string;
  constructor(sessionId: string) { this.sessionId = sessionId; }
  update(input: unknown): AgentEvent[] {
    const message = z.parse(envelope, input);
    if (message.sessionId !== this.sessionId) throw new Error('Unexpected OpenCode session ID');
    const update = message.update;
    const events: unknown[] = [];
    if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') {
      const data = z.parse(chunk, update);
      if (data.content.type === 'text' && typeof data.content.text === 'string') {
        if (update.sessionUpdate === 'agent_message_chunk') { this.text += data.content.text; events.push({ kind: 'text_delta', text: data.content.text }); }
        else { this.thinking += data.content.text; events.push({ kind: 'thinking_delta', text: data.content.text }); }
      }
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const data = z.parse(tool, update);
      if (this.finished.has(data.toolCallId)) return [];
      if (!this.calls.has(data.toolCallId)) {
        this.calls.add(data.toolCallId);
        events.push({ kind: 'tool_call', callId: data.toolCallId, name: data.title || 'OpenCode tool', input: data.rawInput ?? null });
      }
      if (data.status === 'completed' || data.status === 'failed') {
        this.calls.delete(data.toolCallId); this.finished.add(data.toolCallId);
        events.push({ kind: 'tool_result', callId: data.toolCallId, status: data.status, ...(data.rawOutput !== undefined ? { output: data.rawOutput } : {}) });
      }
    } else if (update.sessionUpdate === 'usage_update') {
      const data = z.parse(z.looseObject({ used: z.optional(z.number()), size: z.optional(z.number()), cost: z.optional(z.looseObject({ amount: z.number(), currency: z.string() })) }), update);
      events.push({ kind: 'usage', ...(data.used !== undefined ? { input: data.used } : {}), ...(data.cost?.currency === 'USD' ? { costUsd: data.cost.amount } : {}) });
    }
    return this.validate(events);
  }
  finish(): AgentEvent[] {
    const events: unknown[] = [];
    if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
    if (this.text) events.push({ kind: 'text', text: this.text });
    for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
    this.calls.clear();
    return this.validate(events);
  }
  private validate(events: unknown[]): AgentEvent[] {
    return events.map(event => { const result = parseEventBody(event); if (!result.success) throw new Error('Invalid OpenCode event'); return result.data; });
  }
}
