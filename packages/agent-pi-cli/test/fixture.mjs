const prompt = process.argv.at(-1);
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sessionId = flag('--session') ?? flag('--session-id') ?? 'sess-none';
const line = value => console.log(JSON.stringify(value));
line({ type: 'session', version: 3, id: sessionId, timestamp: '2026-01-01T00:00:00Z', cwd: process.cwd() });
line({ type: 'agent_start' });
line({ type: 'turn_start' });
if (prompt === 'broken') {
  line({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'partial' } });
  process.exit(0);
}
if (prompt === 'aborted') {
  line({ type: 'agent_end', messages: [], willRetry: false });
  line({ type: 'agent_settled', aborted: true });
  process.exit(0);
}
if (prompt === 'tool') {
  line({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' } });
  line({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'bash', result: { content: [{ type: 'text', text: 'files' }] }, isError: false });
}
line({ type: 'message_update', usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 0, totalTokens: 14, cost: { total: 0.01 } }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' } });
line({ type: 'message_end', message: { role: 'assistant' } });
line({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });
line({ type: 'agent_end', messages: [], willRetry: false });
line({ type: 'agent_settled', aborted: false });
