import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const prompt = readFileSync(flag('--prompt-file'), 'utf8');
const sessionId = 'vibe-sess-1';
let n = 0;
const line = value => console.log(JSON.stringify({ id: `e-${n++}`, sessionId, turnId: 'turn-1', createdAt: 0, updatedAt: 0, generationStatus: 'completed', relatedEntryId: null, inputEntryId: null, userDisplayContent: null, source: 'harness', ...value }));
line({ type: 'message', role: 'user', content: [{ type: 'text', text: prompt }], outcome: null });
if (prompt === 'broken') process.exit(0);
if (prompt === 'tool') {
  line({ type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'bash', input: { command: 'ls' } }], outcome: { type: 'committed' } });
  line({ type: 'message', role: 'tool', tool_call_id: 'call-1', content: 'files listed', outcome: { type: 'committed' } });
}
line({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hello' }], outcome: { type: 'committed' } });
