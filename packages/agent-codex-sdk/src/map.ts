import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type { AgentEvent } from '@ormicode/protocol';
import { parseEventBody } from '@ormicode/protocol';

/** Per-turn mapper: tracks item starts because some Codex items only arrive on completion. */
export class CodexEventMapper {
  private readonly calls = new Set<string>();
  private readonly completedCalls = new Set<string>();
  map(event: ThreadEvent): { events: AgentEvent[]; nativeId?: string; terminal?: boolean } {
    const out: unknown[] = [];
    let nativeId: string | undefined;
    let terminal = false;
    if (event.type === 'thread.started') nativeId = event.thread_id;
    else if (event.type === 'turn.started') out.push({ kind: 'turn_start' });
    else if (event.type === 'turn.completed') {
      out.push({ kind: 'usage', input: event.usage.input_tokens, output: event.usage.output_tokens, ...(event.usage.cached_input_tokens == null ? {} : { cacheRead: event.usage.cached_input_tokens }), ...(event.usage.cache_write_input_tokens == null ? {} : { cacheWrite: event.usage.cache_write_input_tokens }) });
      terminal = true;
    } else if (event.type === 'turn.failed') {
      out.push({ kind: 'error', code: 'unknown', message: event.error.message }); terminal = true;
    } else if (event.type === 'error') out.push({ kind: 'error', code: 'unknown', message: event.message });
    else if (event.type === 'item.started') this.start(event.item, out);
    else if (event.type === 'item.completed') this.finish(event.item, out);
    const events = out.map((candidate) => {
      const parsed = parseEventBody(candidate);
      if (!parsed.success) throw new Error(`Invalid mapped Codex event: ${parsed.error}`);
      return parsed.data;
    });
    return { events, ...(nativeId ? { nativeId } : {}), ...(terminal ? { terminal: true } : {}) };
  }
  private start(item: ThreadItem, out: unknown[]): void {
    if (item.type !== 'command_execution' && item.type !== 'mcp_tool_call' && item.type !== 'file_change') return;
    if (this.calls.has(item.id) || this.completedCalls.has(item.id)) throw new Error('Duplicate Codex tool call');
    this.calls.add(item.id);
    const input = item.type === 'command_execution' ? { command: item.command } : item.type === 'mcp_tool_call' ? { server: item.server, tool: item.tool, arguments: item.arguments ?? null } : { changes: item.changes };
    out.push({ kind: 'tool_call', callId: item.id, name: item.type, input });
  }
  private finish(item: ThreadItem, out: unknown[]): void {
    if (item.type === 'agent_message') out.push({ kind: 'text', text: item.text });
    else if (item.type === 'reasoning') out.push({ kind: 'thinking', text: item.text });
    else if (item.type === 'todo_list') out.push({ kind: 'plan', text: item.items.map((entry) => `${entry.completed ? '[x]' : '[ ]'} ${entry.text}`).join('\n') });
    else if (item.type === 'error') out.push({ kind: 'error', code: 'unknown', message: item.message });
    else if (item.type === 'command_execution' || item.type === 'mcp_tool_call' || item.type === 'file_change') {
      if (this.completedCalls.has(item.id)) throw new Error('Duplicate Codex tool completion');
      if (!this.calls.has(item.id)) this.start(item, out);
      this.calls.delete(item.id);
      this.completedCalls.add(item.id);
      const output = item.type === 'command_execution' ? { text: item.aggregated_output, ...(item.exit_code === undefined ? {} : { exitCode: item.exit_code }) } : item.type === 'mcp_tool_call' ? (item.result ?? item.error ?? null) : { changes: item.changes };
      out.push({ kind: 'tool_result', callId: item.id, status: item.status === 'completed' ? 'completed' : 'failed', output });
    }
  }
}
