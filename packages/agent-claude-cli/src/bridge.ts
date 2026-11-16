import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import type { PermissionBroker } from './permissions.ts';

const MAX_BODY = 256 * 1024;

/** A short-lived, authenticated loopback MCP endpoint for one CLI turn. */
export async function startPermissionBridge(broker: PermissionBroker) {
  const token = randomBytes(32).toString('base64url');
  const server = createServer((req, res) => { void handle(req, res); });
  server.maxConnections = 128;
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  const active = new Map<string | number, AbortController>();
  let closing = false;
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = req.headers.authorization ?? '';
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(auth);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401).end(); return; }
    const address = server.address();
    if (!address || typeof address === 'string' || req.headers.host !== `127.0.0.1:${address.port}`) { res.writeHead(403).end(); return; }
    if (req.headers.origin || req.url !== '/mcp' || req.method !== 'POST') { res.writeHead(405).end(); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        const data = Buffer.from(chunk);
        size += data.length;
        if (size > MAX_BODY) { res.writeHead(413).end(); return; }
        chunks.push(data);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (closing) { res.writeHead(503).end(); return; }
      const message = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
      if (message?.method === 'notifications/cancelled') {
        const params = message.params && typeof message.params === 'object' ? message.params as Record<string, unknown> : undefined;
        if (typeof params?.requestId === 'string' || typeof params?.requestId === 'number') active.get(params.requestId)?.abort();
        res.writeHead(202).end(); return;
      }
      const id = message?.method === 'tools/call' && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : undefined;
      if (id !== undefined && active.has(id)) { res.writeHead(409).end(); return; }
      if (id !== undefined && active.size >= 64) { res.writeHead(429).end(); return; }
      const disconnected = new AbortController();
      if (id !== undefined) active.set(id, disconnected);
      const mcp = new McpServer({ name: 'ormicode-permissions', version: '0.1.0' });
      mcp.registerTool('approve', {
        description: 'Ask the session owner to decide a Claude Code tool permission request.',
        inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
      }, async (args, context) => {
        const decision = await broker.request(args.tool_name, args.input, AbortSignal.any([context.signal, disconnected.signal]), args.tool_use_id);
        return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.once('close', () => {
        disconnected.abort();
        if (id !== undefined && active.get(id) === disconnected) active.delete(id);
        void transport.close().catch(() => {}); void mcp.close().catch(() => {});
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
      else if (!res.writableEnded) res.destroy();
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not open permission bridge'); }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, token,
    async close() {
      if (closing) return;
      closing = true;
      broker.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
