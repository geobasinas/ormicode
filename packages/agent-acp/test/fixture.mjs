// Fake ACP agent. FAKE_ACP_MODE: 'v1' | 'v2' | 'reject-v2' (answers -32022 to a v2 initialize).
const mode = process.env.FAKE_ACP_MODE ?? 'v1';
let nextServerId = 100;
let buffer = '';
const pendingClient = new Map(); // requests the agent sent to the client, awaiting response
let promptState = null; // v1: pending prompt request awaiting optional permission reply

function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const update = (sessionId, update) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
const clientRequest = (method, params) => { const id = `s${nextServerId++}`; send({ jsonrpc: '2.0', id, method, params }); return id; };

function finishV1Prompt(sessionId, reason = 'end_turn') {
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });
  if (promptState) { respond(promptState.id, { stopReason: reason }); promptState = null; }
}
function runV2Turn(sessionId, reason = 'end_turn') {
  update(sessionId, { sessionUpdate: 'state_update', state: 'running' });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: { type: 'text', text: 'hello' } });
  update(sessionId, { sessionUpdate: 'usage_update', used: 42, cost: { amount: 0.01, currency: 'USD' } });
  update(sessionId, { sessionUpdate: 'state_update', state: 'idle', stopReason: reason });
}

function handleRequest(msg) {
  const { id, method, params = {} } = msg;
  if (method === 'initialize') {
    if (params.protocolVersion === 2) {
      if (mode === 'reject-v2') return fail(id, -32022, 'Unsupported protocol version', { requested: 2, supported: [1] });
      if (mode !== 'v2') return fail(id, -32022, 'Unsupported protocol version', { requested: 2, supported: [1] });
      return respond(id, { protocolVersion: 2, info: { name: 'fake-acp', version: '2.0.0' }, capabilities: { session: {} } });
    }
    return respond(id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, agentInfo: { name: 'fake-acp', version: '1.0.0' } });
  }
  if (method === 'session/new') {
    if (mode === 'v2') return respond(id, { sessionId: 'fake-v2-1', configOptions: [{ configId: 'mode', category: 'mode', type: 'select', name: 'Mode', currentValue: 'ask', options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] }] });
    return respond(id, { sessionId: 'fake-v1-1', modes: { currentModeId: 'ask', availableModes: [{ id: 'ask', name: 'Ask' }, { id: 'code', name: 'Code' }] } });
  }
  if (method === 'session/load') return respond(id, { sessionId: params.sessionId });
  if (method === 'session/resume') return respond(id, { sessionId: params.sessionId });
  if (method === 'session/list') return respond(id, { sessions: [] });
  if (method === 'session/close') return respond(id, {});
  if (method === 'session/prompt') {
    const text = params.prompt?.[0]?.text ?? '';
    const sessionId = params.sessionId;
    if (mode === 'v2') {
      if (text === 'approval-test') {
        respond(id, { messageId: 'u1' });
        update(sessionId, { sessionUpdate: 'state_update', state: 'requires_action' });
        const rid = clientRequest('session/request_permission', { sessionId, title: 'Run command?', description: 'ls', options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] });
        pendingClient.set(rid, () => runV2Turn(sessionId));
        return;
      }
      respond(id, { messageId: 'u1' });
      if (text === 'wait') return; // resolved by session/cancel -> idle cancelled
      runV2Turn(sessionId);
      return;
    }
    if (text === 'approval-test') {
      const rid = clientRequest('session/request_permission', { sessionId, toolCall: { toolCallId: 'tc-1', title: 'ls' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] });
      promptState = { id, sessionId };
      pendingClient.set(rid, () => finishV1Prompt(sessionId));
      return;
    }
    if (text === 'tool') {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'Read file', status: 'pending', rawInput: { path: 'a' } });
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'completed', rawOutput: 'ok' });
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } });
      return respond(id, { stopReason: 'end_turn' });
    }
    if (text === 'wait') { promptState = { id, sessionId }; return; } // resolved by session/cancel
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });
    return respond(id, { stopReason: 'end_turn' });
  }
  if (method === 'session/set_mode') return respond(id, {});
  if (method === 'session/set_config_option') {
    const value = params.value;
    return respond(id, { configOptions: [{ configId: params.configId, category: 'mode', type: 'select', currentValue: value, options: [{ value: 'ask' }, { value: 'code' }] }] });
  }
  return fail(id, -32601, 'Method not found');
}
function handleNotification(msg) {
  if (msg.method === 'session/cancel') {
    if (mode === 'v2') update(msg.params.sessionId, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'cancelled' });
    else if (promptState) { respond(promptState.id, { stopReason: 'cancelled' }); promptState = null; }
  }
}
process.stdin.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method && msg.id !== undefined) handleRequest(msg);
    else if (msg.method) handleNotification(msg);
    else if (msg.id !== undefined) {
      const resolve = pendingClient.get(String(msg.id).startsWith('s') ? msg.id : `s${msg.id}`) ?? pendingClient.get(msg.id);
      if (resolve) { pendingClient.delete(msg.id); pendingClient.delete(`s${msg.id}`); resolve(msg); }
    }
  }
});
