import readline from 'node:readline';
import { writeFileSync } from 'node:fs';
const lines = readline.createInterface({ input: process.stdin });
let promptId;
let expectedOutcome = 'cancelled';
const configOptions = [
 { id: 'model', category: 'model', type: 'select', currentValue: 'opencode/big-pickle', options: [{ value: 'opencode/big-pickle', name: 'Big Pickle' }, { value: 'opencode/beam-free', name: 'Beam Free' }] },
 { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }] },
];
for await (const line of lines) {
 const message = JSON.parse(line);
 if (message.jsonrpc !== '2.0') process.exit(4);
 const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
 if (message.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
 else if (message.method === 'session/new') reply({ sessionId: 'session-1', configOptions });
 else if (message.method === 'session/load') reply({ sessionId: message.params.sessionId, configOptions });
 else if (message.method === 'session/set_config_option') {
  const option = configOptions.find(entry => entry.id === message.params.configId);
  if (option) option.currentValue = message.params.value;
  reply({ configOptions });
 }
 else if (message.method === 'session/set_mode') reply({});
 else if (message.method === 'session/prompt') {
  promptId = message.id;
  const ask = ['approval-test', 'approval-allow'].includes(message.params.prompt[0].text);
  const choice = message.params.prompt[0].text === 'approval-allow' ? 'allow' : 'deny';
  expectedOutcome = ask ? `selected:${choice}` : 'cancelled';
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } } }) + '\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: { sessionId: message.params.sessionId, toolCall: { toolCallId: 't1', title: 'Edit file' }, options: ask ? [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] : [] } }) + '\n');
 }
 else if (message.id === 'permission-1') {
  const outcome = message.result?.outcome;
  if ((outcome?.outcome === 'selected' ? `selected:${outcome.optionId}` : outcome?.outcome) !== expectedOutcome) process.exit(5);
  if (outcome?.outcome === 'selected' && outcome.optionId === 'allow' && process.env.ORMI_PERMISSION_TEST_FILE) writeFileSync(process.env.ORMI_PERMISSION_TEST_FILE, 'approved fixture write');
  if (outcome.outcome === 'selected') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: outcome.optionId === 'allow' ? 'write applied' : 'write blocked' } } } }) + '\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } }) + '\n');
 }
}
