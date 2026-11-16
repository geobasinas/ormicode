process.stdin.destroy();
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 1 }, total_cost_usd: 0 }) + '\n');
}, 100);
