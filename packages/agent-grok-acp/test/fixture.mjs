import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
let promptId;
let expectedOutcome = 'cancelled';
for await (const line of lines) {
 const message = JSON.parse(line);
 if (message.jsonrpc !== '2.0') process.exit(4);
 const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
 if (message.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
 else if (message.method === 'session/new') reply({ sessionId: 'session-1' });
 else if (message.method === 'session/load') reply({});
 else if (message.method === 'session/prompt') {
  promptId = message.id;
  const ask = message.params.prompt[0].text === 'approval-test';
  expectedOutcome = ask ? 'selected' : 'cancelled';
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } } }) + '\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: { sessionId: message.params.sessionId, toolCall: { toolCallId: 't1', title: 'Edit file' }, options: ask ? [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] : [] } }) + '\n');
 }
 else if (message.id === 'permission-1') {
  if (message.result?.outcome?.outcome !== expectedOutcome || (expectedOutcome === 'selected' && message.result?.outcome?.optionId !== 'deny')) process.exit(5);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } }) + '\n');
 }
}
