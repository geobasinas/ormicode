let input = '';
for await (const chunk of process.stdin) input += chunk;
if (input === 'oversized') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); }
else if (input === 'result-error') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', usage: { input_tokens: 1, output_tokens: 0 }, total_cost_usd: 0, errors: ['budget'] }) + '\n');
  process.exitCode = 1;
}
else if (input === 'nonzero') { process.exitCode = 7; }
else if (input === 'bad-json') { process.stdout.write('not-json\n'); process.exitCode = 1; }
else if (input === 'no-result') { process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'native-test', claude_code_version: 'fixture' }) + '\n'); }
else {
  if (input === 'hold') await new Promise((resolve) => setTimeout(resolve, 250));
  const messages = [
    { type: 'system', subtype: 'init', session_id: input === 'mismatch' ? 'unexpected-session' : 'native-test', claude_code_version: 'fixture' },
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: input }] } },
    { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 2 }, total_cost_usd: 0.001 },
  ];
  for (const message of messages) process.stdout.write(JSON.stringify(message) + '\n');
}
