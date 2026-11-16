import { readFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const file = args[args.indexOf('--prompt-file') + 1];
const prompt = await readFile(file, 'utf8');
if (args.includes('--always-approve') || args[args.indexOf('--permission-mode') + 1] !== 'dontAsk') process.exit(4);
const id = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'session-1';
if (prompt === 'broken') { console.log('{invalid'); process.exit(0); }
console.log(JSON.stringify({ type: 'text', data: prompt }));
console.log(JSON.stringify({ type: 'end', sessionId: id, stopReason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } }));
