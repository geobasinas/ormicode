import * as z from 'zod/mini';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

const base = z.looseObject({ type: z.string() });
const chunk = z.looseObject({ data: z.string() });
const tool = z.looseObject({ toolCallId: z.string().check(z.minLength(1)), title: z.optional(z.nullable(z.string())), toolName: z.optional(z.nullable(z.string())), status: z.optional(z.nullable(z.string())), rawInput: z.optional(z.json()), rawOutput: z.optional(z.json()) });
const end = z.looseObject({ sessionId: z.string().check(z.minLength(1)), stopReason: z.string().check(z.minLength(1)), usage: z.optional(z.looseObject({ input_tokens: z.optional(z.number()), output_tokens: z.optional(z.number()), cache_read_input_tokens: z.optional(z.number()), cache_creation_input_tokens: z.optional(z.number()) })), modelUsage: z.optional(z.record(z.string(), z.unknown())), total_cost_usd: z.optional(z.number()) });

/** Maps streaming-json events; usage comes from the terminal aggregate only. */
export class GrokCliMapper {
  private text = '';
  private thinking = '';
  private ended = false;
  private calls = new Set<string>();
  private finished = new Set<string>();
  map(input: unknown): { events: AgentEvent[]; nativeId?: string; stopReason?: string } {
    const message = z.parse(base, input);
    if (this.ended) throw new Error('Grok output after terminal event');
    const events: unknown[] = [];
    let nativeId: string | undefined; let stopReason: string | undefined;
    if (message.type === 'text' || message.type === 'thought') {
      const value = z.parse(chunk, message).data;
      if (message.type === 'text') { this.text += value; events.push({ kind: 'text_delta', text: value }); }
      else { this.thinking += value; events.push({ kind: 'thinking_delta', text: value }); }
    } else if (message.type === 'tool_call' || message.type === 'tool_call_update') {
      const value = z.parse(tool, message);
      if (this.finished.has(value.toolCallId)) {
        if (message.type === 'tool_call_update') return { events: [] };
        throw new Error('Duplicate Grok tool call');
      }
      if (!this.calls.has(value.toolCallId)) {
        this.calls.add(value.toolCallId);
        events.push({ kind: 'tool_call', callId: value.toolCallId, name: value.toolName || value.title || 'Grok tool', input: value.rawInput ?? null });
      }
      if (value.status === 'completed' || value.status === 'failed') {
        this.calls.delete(value.toolCallId); this.finished.add(value.toolCallId);
        events.push({ kind: 'tool_result', callId: value.toolCallId, status: value.status, ...(value.rawOutput !== undefined ? { output: value.rawOutput } : {}) });
      }
    } else if (message.type === 'error') {
      const value = z.parse(z.looseObject({ message: z.string() }), message);
      events.push({ kind: 'error', code: 'unknown', message: value.message });
      this.ended = true; stopReason = 'error';
    } else if (message.type === 'end') {
      const value = z.parse(end, message); this.ended = true; nativeId = value.sessionId; stopReason = value.stopReason;
      if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
      if (this.text) events.push({ kind: 'text', text: this.text });
      for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
      const models = Object.keys(value.modelUsage ?? {});
      if (value.usage || value.total_cost_usd !== undefined) events.push({ kind: 'usage', ...(models.length === 1 ? { model: models[0] } : {}), ...(value.usage?.input_tokens !== undefined ? { input: value.usage.input_tokens } : {}), ...(value.usage?.output_tokens !== undefined ? { output: value.usage.output_tokens } : {}), ...(value.usage?.cache_read_input_tokens !== undefined ? { cacheRead: value.usage.cache_read_input_tokens } : {}), ...(value.usage?.cache_creation_input_tokens !== undefined ? { cacheWrite: value.usage.cache_creation_input_tokens } : {}), ...(value.total_cost_usd !== undefined ? { costUsd: value.total_cost_usd } : {}) });
    }
    return { events: events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error('Invalid Grok CLI event'); return parsed.data; }), ...(nativeId ? { nativeId } : {}), ...(stopReason ? { stopReason } : {}) };
  }
}
