import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
let promptId;
let expectedOutcome = 'cancelled';
let usage;
for await (const line of lines) {
 const message = JSON.parse(line);
 if (message.jsonrpc !== '2.0') process.exit(4);
 const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
 if (message.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
 else if (message.method === 'session/new') reply({ sessionId: 'session-1' });
 else if (message.method === 'session/load') reply({});
 else if (message.method === 'session/prompt') {
  promptId = message.id;
  usage = message.params.prompt[0].text === 'usage-test' ? { inputTokens: 12, outputTokens: 3, cacheReadInputTokens: 2, model: 'x-ai/grok-code-fast-1' } : undefined;
  const ask = ['approval-test', 'approval-allow'].includes(message.params.prompt[0].text);
  const choice = message.params.prompt[0].text === 'approval-allow' ? 'allow' : 'deny';
  expectedOutcome = ask ? `selected:${choice}` : 'cancelled';
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } } }) + '\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: { sessionId: message.params.sessionId, toolCall: { toolCallId: 't1', title: 'Edit file' }, options: ask ? [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] : [] } }) + '\n');
 }
 else if (message.id === 'permission-1') {
  const actual = message.result?.outcome;
  if ((actual?.outcome === 'selected' ? `selected:${actual.optionId}` : actual?.outcome) !== expectedOutcome) process.exit(5);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn', ...(usage ? { usage } : {}) } }) + '\n');
 }
}
