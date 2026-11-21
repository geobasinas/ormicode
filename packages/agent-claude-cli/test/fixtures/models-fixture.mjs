import readline from 'node:readline';
// Fake `claude` for models(): answers the `initialize` control request with a model
// catalog. ORMICODE_FIXTURE_MODELS modes: 'ok' (default), 'exit' (die before answering),
// 'badjson' (emit a malformed line).
const mode = process.env.ORMICODE_FIXTURE_MODELS ?? 'ok';
const out = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
if (mode === 'exit') process.exit(0);
if (mode === 'badjson') process.stdout.write('not-json\n');
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.type !== 'control_request') continue;
  out({ type: 'control_response', response: { subtype: 'success', request_id: 'unrelated', response: {} } });
  out({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: message.request_id,
      response: {
        models: [
          { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
          { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportedEffortLevels: ['low', 'high'] },
          { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
        ],
      },
    },
  });
}
