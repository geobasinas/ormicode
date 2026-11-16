const prompt = process.argv.at(-1);
const sessionId = process.env.ORMICODE_FIXTURE_SESSION ?? 'ses_fake';
const line = value => console.log(JSON.stringify({ timestamp: 0, sessionID: sessionId, ...value }));
if (prompt === 'broken') {
  line({ type: 'text', part: { id: 'p1', sessionID: sessionId, messageID: 'm1', type: 'text', text: 'partial' } });
  process.exit(0);
}
if (prompt === 'tool') {
  line({ type: 'step_start', part: { id: 'p1', sessionID: sessionId, messageID: 'm1', type: 'step-start' } });
  line({ type: 'tool_use', part: { partID: 'p2', sessionID: sessionId, messageID: 'm1', type: 'tool', id: 'call-1', tool: 'read', state: { status: 'completed', input: { path: '.' }, output: 'file list' } } });
  line({ type: 'step_finish', part: { id: 'p3', sessionID: sessionId, messageID: 'm1', type: 'step-finish', reason: 'tool-calls', cost: 0, tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } } });
  line({ type: 'step_start', part: { id: 'p4', sessionID: sessionId, messageID: 'm2', type: 'step-start' } });
  line({ type: 'text', part: { id: 'p5', sessionID: sessionId, messageID: 'm2', type: 'text', text: 'done' } });
  line({ type: 'step_finish', part: { id: 'p6', sessionID: sessionId, messageID: 'm2', type: 'step-finish', reason: 'stop', cost: 0.01, tokens: { input: 7, output: 3, reasoning: 0, cache: { read: 4, write: 0 } } } });
  process.exit(0);
}
line({ type: 'step_start', part: { id: 'p1', sessionID: sessionId, messageID: 'm1', type: 'step-start' } });
line({ type: 'text', part: { id: 'p2', sessionID: sessionId, messageID: 'm1', type: 'text', text: 'hello' } });
line({ type: 'step_finish', part: { id: 'p3', sessionID: sessionId, messageID: 'm1', type: 'step-finish', reason: 'stop', cost: 0, tokens: { input: 10, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } } });
