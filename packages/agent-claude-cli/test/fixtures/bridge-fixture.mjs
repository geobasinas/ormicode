import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
const entry = Object.values(config.mcpServers)[0];
const client = new Client({ name: 'fake-claude', version: '1.0.0' });
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'native-bridge', claude_code_version: 'fixture' }) + '\n');
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: { Authorization: `Bearer ${process.env.ORMICODE_CLI_APPROVAL_TOKEN}` } } }));
  const response = await client.callTool({ name: 'approve', arguments: { tool_name: 'Write', input: { file_path: 'marker.txt', content: 'safe' }, tool_use_id: 'fixture-call' } });
  const decision = JSON.parse(response.content[0].text);
  const target = process.env.ORMICODE_FIXTURE_WRITE;
  if (decision.behavior === 'allow' && target) writeFileSync(target, String(decision.updatedInput?.content ?? ''));
  process.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: decision.behavior }] } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }) + '\n');
} finally { await client.close(); }
