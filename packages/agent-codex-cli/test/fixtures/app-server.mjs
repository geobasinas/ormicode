import readline from 'node:readline';
const out = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
const notify = (method, params) => out({ method, params });
let nextRequest = 1000;
let nextTurn = 0;
let failInterrupt = false;
const pending = new Map();
const finishTurn = (threadId, turnId) => {
  notify('item/started', { threadId, turnId, item: { type: 'agent_message', id: 'msg-1', text: 'ok' } });
  notify('item/completed', { threadId, turnId, item: { type: 'agent_message', id: 'msg-1', text: 'ok' } });
  notify('turn/completed', { threadId, turn: { id: turnId, usage: { input_tokens: 3, output_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0 } } });
};
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.id !== undefined && message.method === undefined) {
    const pending_ = pending.get(message.id); pending.delete(message.id);
    if (pending_) pending_(message);
    continue;
  }
  if (message.method === 'initialize') out({ id: message.id, result: { userAgent: 'fixture', codexHome: '/tmp', platformFamily: 'test', platformOs: 'test' } });
  else if (message.method === 'test/echo') out({ id: message.id, result: message.params });
  else if (message.method === 'thread/start' || message.method === 'thread/resume') {
    if (!['never', 'on-request'].includes(message.params.approvalPolicy) || !['read-only', 'workspace-write'].includes(message.params.sandbox)) process.exit(4);
    out({ id: message.id, result: { thread: { id: message.params.threadId ?? 'thread-1' } } });
  }
  else if (message.method === 'model/list') out({ id: message.id, result: { data: [{ id: 'gpt-test-1', displayName: 'GPT Test', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }, { id: 'hidden-model', hidden: true }], nextCursor: null } });
  else if (message.method === 'turn/start') {
    if (message.params.threadId !== 'thread-1' || message.params.input[0].type !== 'text' || !Array.isArray(message.params.input[0].text_elements)) process.exit(5);
    const text = message.params.input[0].text;
    failInterrupt = text === 'interrupt fails';
    const turnId = `turn-${++nextTurn}`;
    out({ id: message.id, result: { turn: { id: turnId } } });
    notify('turn/started', { threadId: 'thread-1', turn: { id: turnId } });
    notify('item/agentMessage/delta', { threadId: 'thread-1', turnId, itemId: 'msg-1', delta: 'o' });
    if (text === 'fail turn') {
      notify('turn/completed', { threadId: 'thread-1', turn: { id: turnId, status: 'failed', error: { message: 'fixture turn failed' } } });
    } else if (text === 'retry succeeds' || text === 'retry fails' || text === 'fatal error') {
      const retry = text !== 'fatal error';
      notify('error', { threadId: 'thread-1', turnId, error: { message: retry ? 'Reconnecting stream' : 'Unrecoverable error' }, willRetry: retry });
      if (text === 'retry fails') notify('turn/completed', { threadId: 'thread-1', turn: { id: turnId, status: 'failed', error: { message: 'Retries exhausted' } } });
      else finishTurn('thread-1', turnId);
    } else if (text === 'approve me' || text === 'approval ends' || text === 'interrupt fails') {
      const rid = ++nextRequest;
      pending.set(rid, message => { if (message.result?.decision === 'cancel') return; if (text === 'approval ends') process.exit(7); finishTurn('thread-1', turnId); });
      out({ id: rid, method: 'item/commandExecution/requestApproval', params: { approvalId: 'ap-1', itemId: 'item-1', threadId: 'thread-1', turnId, command: 'rm -rf /tmp/x', reason: 'fixture' } });
      if (text === 'approval ends') finishTurn('thread-1', turnId);
    } else if (text === 'question me') {
      const rid = ++nextRequest;
      pending.set(rid, message => { if (Object.keys(message.result?.answers ?? {}).length) finishTurn('thread-1', turnId); });
      out({ id: rid, method: 'item/tool/requestUserInput', params: { threadId: 'thread-1', turnId, questions: [{ id: 'q', question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'First' }] }] } });
    } else finishTurn('thread-1', turnId);
  }
  else if (message.method === 'turn/steer') {
    if (!message.params.expectedTurnId) process.exit(6);
    out({ id: message.id, result: {} });
    notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: ' steered' });
  }
  else if (message.method === 'turn/interrupt') {
    if (failInterrupt)
      out({ id: message.id, error: { code: -32000, message: 'interrupt refused' } });
    else {
      out({ id: message.id, result: {} });
      notify('turn/completed', { threadId: 'thread-1', turn: { id: message.params.turnId, status: 'interrupted' } });
    }
  }
  else if (message.method === 'test/crash') process.exit(3);
}
