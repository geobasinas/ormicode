import type { AgentEvent } from '@ormicode/protocol';
import { parseEventBody } from '@ormicode/protocol';

/** Official app-server v2 ThreadItem fields this mapper reads (camelCase, tagged by `type`). */
interface AppItem { type?: string; id?: string; text?: string; summary?: string[]; content?: string[]; command?: string; aggregatedOutput?: string | null; exitCode?: number | null; status?: string; server?: string; tool?: string; arguments?: unknown; result?: unknown; error?: unknown; changes?: unknown; items?: { text?: string; completed?: boolean }[] }
interface TokenBreakdown { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteInputTokens?: number }

/** Tool-call names stay stable across transports so stored history renders the same. */
const TOOL_NAMES: Record<string, string> = { commandExecution: 'command_execution', mcpToolCall: 'mcp_tool_call', fileChange: 'file_change' };

export interface MappedNotification {
  events: AgentEvent[];
  nativeId?: string;
  /** Set by turn/started. */
  turnId?: string;
  /** Set by turn/completed: the turn is over and a turn_end must follow `events`. */
  ended?: { turnId?: string; interrupted: boolean };
}

/**
 * Per-session mapper from official `codex app-server` notifications to AgentEvents.
 * Tracks tool starts (some items only arrive on completion) and the turn's last token
 * usage and rerouted model, which the app-server reports before turn/completed.
 */
export class CodexNotificationMapper {
  private readonly calls = new Set<string>();
  private readonly completedCalls = new Set<string>();
  private usage?: TokenBreakdown;
  private reroutedModel?: string;

  /** `model` labels usage events unless the app-server rerouted this turn. */
  map(method: string, params: unknown, model?: string): MappedNotification {
    const p = (params ?? {}) as Record<string, unknown>;
    const out: unknown[] = [];
    const result: MappedNotification = { events: [] };
    if (method === 'item/started') this.start(p.item as AppItem, out);
    else if (method === 'item/completed') this.finish(p.item as AppItem, out);
    else if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') out.push({ kind: 'text_delta', text: (p.delta as string) ?? '' });
    else if (method === 'item/reasoning/textDelta') out.push({ kind: 'thinking_delta', text: (p.delta as string) ?? '' });
    else if (method === 'thread/started') result.nativeId = (p.thread as { id: string }).id;
    else if (method === 'turn/started') { result.turnId = (p.turn as { id: string }).id; out.push({ kind: 'turn_start' }); }
    else if (method === 'model/rerouted') this.reroutedModel = (p.toModel as string) || undefined;
    else if (method === 'thread/tokenUsage/updated') {
      const last = (p.tokenUsage as { last?: TokenBreakdown } | undefined)?.last;
      if (last) this.usage = last;
    }
    else if (method === 'turn/completed') {
      const turn = p.turn as { id?: string; status?: string; error?: { message?: string } | null } | undefined;
      if (turn?.status === 'failed' || turn?.error?.message) out.push({ kind: 'error', code: 'unknown', message: turn?.error?.message ?? 'turn failed' });
      else {
        const usage = this.usage ?? {};
        const label = this.reroutedModel ?? model;
        out.push({ kind: 'usage', input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, cacheRead: usage.cachedInputTokens ?? 0, cacheWrite: usage.cacheWriteInputTokens ?? 0, ...(label ? { model: label } : {}) });
      }
      result.ended = { ...(turn?.id ? { turnId: turn.id } : {}), interrupted: turn?.status === 'interrupted' };
      this.usage = undefined; this.reroutedModel = undefined;
    }
    else if (method === 'error') {
      const error = p as { message?: string; error?: { message?: string }; willRetry?: boolean };
      const message = String(error.error?.message ?? error.message ?? 'Codex app-server error');
      out.push(error.willRetry === true ? { kind: 'state', state: 'retrying', reason: message } : { kind: 'error', code: 'unknown', message });
    }
    result.events = out.map((candidate) => {
      const parsed = parseEventBody(candidate);
      if (!parsed.success) throw new Error(`Invalid mapped Codex event: ${parsed.error}`);
      return parsed.data;
    });
    return result;
  }
  private start(item: AppItem | undefined, out: unknown[]): void {
    const name = item?.type ? TOOL_NAMES[item.type] : undefined;
    if (!item || !name || !item.id) return;
    if (this.calls.has(item.id) || this.completedCalls.has(item.id)) throw new Error('Duplicate Codex tool call');
    this.calls.add(item.id);
    const input = item.type === 'commandExecution' ? { command: item.command ?? '' } : item.type === 'mcpToolCall' ? { server: item.server ?? '', tool: item.tool ?? '', arguments: item.arguments ?? null } : { changes: item.changes ?? [] };
    out.push({ kind: 'tool_call', callId: item.id, name, input });
  }
  private finish(item: AppItem | undefined, out: unknown[]): void {
    if (!item) return;
    if (item.type === 'agentMessage') out.push({ kind: 'text', text: item.text ?? '' });
    else if (item.type === 'reasoning') out.push({ kind: 'thinking', text: item.text ?? (item.summary ?? []).join('\n') });
    else if (item.type === 'plan') out.push({ kind: 'plan', text: item.items ? item.items.map((entry) => `${entry.completed ? '[x]' : '[ ]'} ${entry.text ?? ''}`).join('\n') : item.text ?? '' });
    else if (item.type && item.id && TOOL_NAMES[item.type]) {
      if (this.completedCalls.has(item.id)) throw new Error('Duplicate Codex tool completion');
      if (!this.calls.has(item.id)) this.start(item, out);
      this.calls.delete(item.id);
      this.completedCalls.add(item.id);
      const output = item.type === 'commandExecution' ? { text: item.aggregatedOutput ?? '', ...(item.exitCode == null ? {} : { exitCode: item.exitCode }) } : item.type === 'mcpToolCall' ? (item.result ?? item.error ?? null) : { changes: item.changes ?? [] };
      out.push({ kind: 'tool_result', callId: item.id, status: item.status === 'completed' ? 'completed' : 'failed', output });
    }
  }
}
