import * as z from 'zod/mini';
import { parseEventBody } from '@ormicode/protocol';
import type { AgentEvent } from '@ormicode/protocol';

const base = z.looseObject({ type: z.optional(z.string()), role: z.optional(z.string()), sessionId: z.optional(z.string()) });
const contentBlock = z.looseObject({ type: z.string(), text: z.optional(z.string()), id: z.optional(z.string()), name: z.optional(z.string()), input: z.optional(z.json()), tool_call_id: z.optional(z.string()) });
const message = z.looseObject({ role: z.string(), content: z.optional(z.union([z.string(), z.array(contentBlock)])), reasoning_content: z.optional(z.string()), tool_call_id: z.optional(z.string()), generationStatus: z.optional(z.nullable(z.string())), outcome: z.optional(z.nullable(z.union([z.string(), z.looseObject({ type: z.optional(z.string()) })]))) });
const result = z.looseObject({ usage: z.optional(z.looseObject({ input_tokens: z.optional(z.number()), output_tokens: z.optional(z.number()), prompt_tokens: z.optional(z.number()), completion_tokens: z.optional(z.number()), cached_tokens: z.optional(z.number()) })), total_cost_usd: z.optional(z.number()), cost_usd: z.optional(z.number()), outcome: z.optional(z.string()), is_error: z.optional(z.boolean()) });

/** Maps `vibe --output streaming` journal entries. Entries carry the native sessionId on every record. */
export class VibeCliMapper {
  private text = '';
  private thinking = '';
  private completed = false;
  private generationFailed = false;
  private readonly calls = new Set<string>();
  private readonly finished = new Set<string>();
  /** A turn completes on a terminal `result` record or a committed assistant entry; generation failures mark it failed. */
  get completedEntry(): boolean { return this.completed; }
  get failedGeneration(): boolean { return this.generationFailed; }
  map(input: unknown): { events: AgentEvent[]; nativeId?: string; terminal?: boolean; failed?: boolean } {
    const message_ = z.parse(base, input);
    const events: unknown[] = [];
    const nativeId = message_.sessionId;
    let terminal = false; let failed = false;
    if (message_.type === 'message' || message_.role !== undefined) {
      const entry = z.parse(message, input);
      if (entry.role === 'assistant') {
        const blocks = typeof entry.content === 'string' ? [{ type: 'text', text: entry.content }] : (entry.content ?? []);
        for (const block of blocks) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            this.text += block.text; events.push({ kind: 'text_delta', text: block.text });
          } else if (block.type === 'reasoning' || block.type === 'thinking') {
            if (typeof block.text === 'string' && block.text) { this.thinking += block.text; events.push({ kind: 'thinking_delta', text: block.text }); }
          } else if ((block.type === 'tool_use' || block.type === 'tool_call') && block.id) {
            const callId = block.id;
            if (!this.finished.has(callId) && !this.calls.has(callId)) {
              this.calls.add(callId);
              events.push({ kind: 'tool_call', callId, name: block.name || 'Vibe tool', input: block.input ?? null });
            }
          }
        }
        if (entry.reasoning_content) { this.thinking += entry.reasoning_content; events.push({ kind: 'thinking_delta', text: entry.reasoning_content }); }
        const outcomeType = typeof entry.outcome === 'object' ? entry.outcome?.type : entry.outcome;
        if (entry.generationStatus === 'failed' || entry.generationStatus === 'interrupted' || outcomeType === 'error') this.generationFailed = true;
        else if (entry.generationStatus === 'completed' && (outcomeType === 'committed' || outcomeType === undefined || outcomeType === null)) this.completed = true;
      } else if (entry.role === 'tool' && entry.tool_call_id) {
        const outcomeType = typeof entry.outcome === 'object' ? entry.outcome?.type : entry.outcome;
        const callId = entry.tool_call_id;
        if (!this.finished.has(callId)) {
          this.calls.delete(callId); this.finished.add(callId);
          const output = typeof entry.content === 'string' ? entry.content : (entry.content !== undefined ? entry.content : null);
          events.push({ kind: 'tool_result', callId, status: outcomeType === 'error' ? 'failed' : 'completed', output });
        }
      }
    } else if (message_.type === 'result') {
      const value = z.parse(result, input);
      terminal = true; failed = value.is_error === true || value.outcome === 'error';
      const usage = value.usage;
      const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
      const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
      const cost = value.total_cost_usd ?? value.cost_usd;
      if (inputTokens !== undefined || outputTokens !== undefined || usage?.cached_tokens !== undefined || cost !== undefined) {
        events.push({ kind: 'usage', ...(inputTokens !== undefined ? { input: inputTokens } : {}), ...(outputTokens !== undefined ? { output: outputTokens } : {}), ...(usage?.cached_tokens !== undefined ? { cacheRead: usage.cached_tokens } : {}), ...(cost !== undefined ? { costUsd: cost } : {}) });
      }
    }
    return { events: events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error('Invalid Vibe CLI event'); return parsed.data; }), ...(nativeId ? { nativeId } : {}), ...(terminal ? { terminal, failed } : {}) };
  }
  /** Emit retained text and close tool calls that never finished. */
  finish(): AgentEvent[] {
    const events: unknown[] = [];
    if (this.thinking) events.push({ kind: 'thinking', text: this.thinking });
    if (this.text) events.push({ kind: 'text', text: this.text });
    this.thinking = ''; this.text = '';
    for (const callId of this.calls) events.push({ kind: 'tool_result', callId, status: 'interrupted' });
    this.calls.clear();
    return events.map(event => { const parsed = parseEventBody(event); if (!parsed.success) throw new Error('Invalid Vibe CLI event'); return parsed.data; });
  }
}
