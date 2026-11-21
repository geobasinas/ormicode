import { readFile } from 'node:fs/promises';
const args = process.argv.slice(2);
if (args[0] === 'models') { console.log('Available models:\n  - grok-4.6\n  - grok-code-fast-1'); process.exit(0); }
const file = args[args.indexOf('--prompt-file') + 1];
const prompt = await readFile(file, 'utf8');
// headless runs cannot answer approval prompts: --always-approve or an explicit --permission-mode
if (!args.includes('--always-approve') && !args.includes('--permission-mode')) process.exit(4);
const id = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'session-1';
if (prompt === 'broken') { console.log('{invalid'); process.exit(0); }
console.log(JSON.stringify({ type: 'text', data: prompt }));
if (prompt === 'slow') setTimeout(() => {}, 60_000); // stays mid-turn until killed
else console.log(JSON.stringify({ type: 'end', sessionId: id, stopReason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } }));
