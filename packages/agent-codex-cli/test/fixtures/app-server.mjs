import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: 'fixture', codexHome: '/tmp', platformFamily: 'test', platformOs: 'test' } }) + '\n');
  else if (message.method === 'test/echo') process.stdout.write(JSON.stringify({ id: message.id, result: message.params }) + '\n');
  else if (message.method === 'thread/start' || message.method === 'thread/resume') {
    if (message.params.approvalPolicy !== 'never' || message.params.sandbox !== 'read-only') process.exit(4);
    process.stdout.write(JSON.stringify({ id: message.id, result: { thread: { id: message.params.threadId ?? 'thread-1' } } }) + '\n');
  }
  else if (message.method === 'turn/start') {
    if (message.params.threadId !== 'thread-1' || message.params.input[0].type !== 'text' || !Array.isArray(message.params.input[0].text_elements)) process.exit(5);
    process.stdout.write(JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } }) + '\n');
  }
  else if (message.method === 'turn/interrupt') process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\n');
  else if (message.method === 'test/crash') process.exit(3);
}
