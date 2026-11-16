import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const prompt = readFileSync(flag('--prompt-file'), 'utf8');
const sessionId = 'vibe-sess-1';
const line = value => console.log(JSON.stringify({ id: `e-${Math.random()}`, sessionId, createdAt: 0, ...value }));
if (prompt === 'broken') {
  line({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'partial' }] });
  process.exit(0);
}
if (prompt === 'tool') {
  line({ type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'bash', input: { command: 'ls' } }] });
  line({ type: 'message', role: 'tool', tool_call_id: 'call-1', content: 'files listed' });
}
line({ type: 'message', role: 'user', content: [{ type: 'text', text: prompt }] });
line({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'hello' }] });
line({ type: 'result', usage: { input_tokens: 12, output_tokens: 3 }, total_cost_usd: 0.02 });
