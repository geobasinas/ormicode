/**
 * The built-in `ormi` MCP server: a stdio JSON-RPC server the daemon hands
 * to every session (adapters that accept mcpServers). Each tool is a thin
 * wrapper over an existing protocol method — no new capability, and every
 * call is journaled through the normal session methods. Session scope comes
 * from env: ORMICODE_SOCKET + ORMI_SESSION + ORMI_MCP_TOKEN.
 */
import { connect } from './socket.ts';
import { newId } from '@ormicode/protocol';
import { TEAM_TOOLS, callTeamTool } from './team-mcp.ts';
import type { McpProof } from './mcp-auth.ts';

interface JsonRpc { jsonrpc?: string; id?: string | number; method: string; params?: Record<string, unknown> }

const text = (s: string) => ({ content: [{ type: 'text', text: s }] });
const errText = (s: string) => ({ content: [{ type: 'text', text: s }], isError: true });

export const TOOLS = [
  ...TEAM_TOOLS,
  { name: 'ormi_sessions', description: 'List sessions in this project, or read one session\'s state', inputSchema: { type: 'object', properties: { session: { type: 'string', description: 'session id to get; omit to list all' } } } },
  { name: 'ormi_start', description: 'Start a sibling session (own worktree) with an agent and prompt. Returns its session id.', inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, vendor: { type: 'string' }, transport: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' } } } },
  { name: 'ormi_message', description: 'Send a follow-up prompt to a session this one started', inputSchema: { type: 'object', required: ['session', 'text'], properties: { session: { type: 'string' }, text: { type: 'string' } } } },
  { name: 'ormi_wait', description: 'Wait for a session this one started to finish its turn (idle/done), need approval, or fail', inputSchema: { type: 'object', required: ['session'], properties: { session: { type: 'string' }, until: { type: 'string', enum: ['idle', 'done', 'approval'] }, timeoutMs: { type: 'number' } } } },
  { name: 'ormi_handoff', description: 'Hand this task to another agent or model. You write the brief.', inputSchema: { type: 'object', required: ['reason'], properties: { vendor: { type: 'string' }, transport: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, mode: { type: 'string', enum: ['in_place', 'rehydrate', 'fork'] }, brief: { type: 'string' }, reason: { type: 'string' } } } },
  { name: 'ormi_notes', description: 'Read this session\'s notes, or write one (title + body)', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } } },
  { name: 'ormi_browser_open', description: 'Use this to check your own UI changes on the session dev server. Open only this session preview; inspect it with snapshot before interacting.', inputSchema: { type: 'object', properties: { port: { type: 'number' }, path: { type: 'string' }, url: { type: 'string' }, device: { type: 'string', enum: ['phone', 'tablet', 'desktop'] } } } },
  { name: 'ormi_browser_click', description: 'Click an element in your own session preview. Use snapshot first and prefer role= selectors such as role=button[name=\"Save\"].', inputSchema: { type: 'object', required: ['selector'], properties: { selector: { type: 'string' } } } },
  { name: 'ormi_browser_type', description: 'Type into your own session preview. Use snapshot first and prefer role= selectors.', inputSchema: { type: 'object', required: ['selector', 'text'], properties: { selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } } } },
  { name: 'ormi_browser_snapshot', description: 'Read the accessible snapshot of your own session preview before choosing click or type selectors.', inputSchema: { type: 'object', properties: {} } },
  { name: 'ormi_browser_screenshot', description: 'Capture a screenshot of your own session preview for visual verification.', inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' }, selector: { type: 'string' } } } },
  { name: 'ormi_browser_logs', description: 'Read console and network errors from your own session preview.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['console', 'network', 'all'] }, after: { type: 'number' } } } },
];

export function formatBrowserLogs(entries: Record<string, unknown>[], maxBytes = 16 * 1024): string {
  const lines = entries.map(entry => {
    const parts = [`${String(entry.level ?? 'error')}/${String(entry.kind ?? 'console')}`, String(entry.message ?? '')];
    if (entry.method || entry.url) parts.push(`Request: ${String(entry.method ?? 'GET')} ${String(entry.url ?? '')} ${entry.status ? `(${entry.status})` : ''}`.trim());
    if (entry.requestBody) parts.push(`Request body: ${String(entry.requestBody)}`);
    if (entry.responseBody) parts.push(`Response: ${String(entry.responseBody)}`);
    if (entry.stack) parts.push(`Stack:\n${String(entry.stack).split('\n').slice(0, 5).join('\n')}`);
    return parts.join('\n');
  });
  let result = '';
  for (const line of lines) {
    const next = `${result ? '\n\n' : ''}${line}`;
    if (Buffer.byteLength(result + next) > maxBytes) break;
    result += next;
  }
  return result;
}

type BrowserRequest = (method: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
export async function callBrowserTool(name: string, args: Record<string, unknown>, self: string, req: BrowserRequest): Promise<unknown> {
  switch (name) {
    case 'ormi_browser_open': return text(JSON.stringify(await req('browser.open', { ...args, session: self })));
    case 'ormi_browser_click': return text(JSON.stringify(await req('browser.click', { selector: String(args.selector), session: self })));
    case 'ormi_browser_type': return text(JSON.stringify(await req('browser.type', { selector: String(args.selector), text: String(args.text), submit: Boolean(args.submit), session: self })));
    case 'ormi_browser_snapshot': return text(String((await req('browser.snapshot', { session: self })).snapshot ?? ''));
    case 'ormi_browser_screenshot': {
      const r = await req('browser.screenshot', { session: self, ...args });
      const artifact = String(r.artifact ?? '');
      const image = await req('browser.artifact', { session: self, id: artifact });
      return { content: [
        { type: 'text', text: `Screenshot saved as ${artifact}` },
        { type: 'image', data: String(r.jpeg ?? image.data), mimeType: 'image/jpeg' },
      ] };
    }
    case 'ormi_browser_logs': {
      const r = await req('preview.console', { session: self, ...(args.after === undefined ? {} : { after: Number(args.after) }) }) as { entries?: Record<string, unknown>[] };
      const kind = String(args.kind ?? 'all');
      const entries = (r.entries ?? []).filter(entry => kind === 'all' || entry.kind === kind || (kind === 'console' && ['console', 'error', 'rejection'].includes(String(entry.kind))));
      return text(formatBrowserLogs(entries));
    }
    default: return errText(`unknown tool ${name}`);
  }
}

/** Run the stdio server until stdin closes. `self` is the owning session id. */
export async function serveOrmiMcp(socketPath: string, self: string, token: string): Promise<void> {
  const proof = { session: self, token };
  const link = await connect(socketPath, { v: 1, type: 'hello', role: 'client', proto: 1, device: 'mcp' });
  const req = async (method: string, body: Record<string, unknown>, timeoutMs = 120_000) => {
    const res = await link.request(method, body, timeoutMs, proof);
    if (res.type === 'err') throw new Error(`${res.code}: ${res.message}`);
    return res.body as Record<string, unknown>;
  };
  // Only sessions this one started (parent === self) may be messaged or waited on.
  const owns = async (target: string): Promise<boolean> => {
    if (target === self) return true;
    const s = await req('session.get', { session: target }).catch(() => undefined);
    return s?.parent === self;
  };

  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name.startsWith('team_')) return text(await callTeamTool(name, args, self, req,
      (session, until, timeout) => waitFor(link, session, until, timeout, proof)));
    switch (name) {
      case 'ormi_sessions': {
        if (args.session) return text(JSON.stringify(await req('session.get', { session: args.session })));
        const r = await req('session.list', {}) as { sessions: unknown[] };
        return text(JSON.stringify(r.sessions));
      }
      case 'ormi_start': {
        const mine = await req('session.get', { session: self }).catch(() => undefined) as { project?: string } | undefined;
        const r = await req('session.start', {
          machine: newId('m'), project: mine?.project ?? process.cwd(),
          vendor: String(args.vendor ?? 'claude'), transport: String(args.transport ?? 'sdk'),
          model: String(args.model ?? 'default'), effort: String(args.effort ?? 'default'), mode: 'default',
          workspace: { kind: 'worktree', branch: `ormi-${newId('s').slice(2, 10)}` }, parent: self,
        }) as { session: string };
        await req('session.prompt', { session: r.session, text: String(args.prompt) });
        return text(JSON.stringify({ session: r.session }));
      }
      case 'ormi_message': {
        if (!await owns(String(args.session))) return errText('ormicode only lets a session message sessions it started');
        await req('session.prompt', { session: String(args.session), text: String(args.text) });
        return text('sent');
      }
      case 'ormi_wait': {
        if (!await owns(String(args.session))) return errText('ormicode only lets a session wait on sessions it started');
        const until = String(args.until ?? 'idle');
        const timeout = Number(args.timeoutMs ?? 120_000);
        return text(await waitFor(link, String(args.session), until, timeout, proof));
      }
      case 'ormi_handoff': {
        const r = await req('session.handoff', {
          session: self,
          to: { vendor: args.vendor, transport: args.transport, model: args.model, effort: args.effort },
          mode: String(args.mode ?? 'rehydrate'), brief: args.brief, reason: args.reason,
          agentApproval: true,
        });
        return text(JSON.stringify(r));
      }
      case 'ormi_notes': {
        if (args.title !== undefined || args.body !== undefined) {
          const r = await req('session.setNotes', { session: self, title: String(args.title ?? 'note'), body: String(args.body ?? '') });
          return text(JSON.stringify(r));
        }
        return text(JSON.stringify(await req('session.getNotes', { session: self })));
      }
      case 'ormi_browser_open':
      case 'ormi_browser_click':
      case 'ormi_browser_type':
      case 'ormi_browser_snapshot':
      case 'ormi_browser_screenshot':
      case 'ormi_browser_logs':
        return callBrowserTool(name, args, self, req);
      default: return errText(`unknown tool ${name}`);
    }
  };

  let buf = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg: JsonRpc;
      try { msg = JSON.parse(line); } catch { continue; }
      const out = await handle(msg);
      if (out !== undefined) process.stdout.write(JSON.stringify(out) + '\n');
    }
  }

  async function handle(msg: JsonRpc): Promise<Record<string, unknown> | undefined> {
    if (msg.id === undefined) return undefined; // notification
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
    try {
      switch (msg.method) {
        case 'initialize':
          return reply({ protocolVersion: String((msg.params?.protocolVersion) ?? '2025-06-18'), capabilities: { tools: {} }, serverInfo: { name: 'ormi', version: '0.0.0' } });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: TOOLS });
        case 'tools/call': {
          const p = msg.params as { name: string; arguments?: Record<string, unknown> };
          return reply(await call(p.name, p.arguments ?? {}));
        }
        default:
          return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } };
      }
    } catch (error) {
      return reply(errText(error instanceof Error ? error.message : String(error)));
    }
  }
}

/** Subscribe and watch live events until the session settles or times out. */
async function waitFor(link: Awaited<ReturnType<typeof connect>>, session: string, until: string, timeoutMs: number, proof: McpProof): Promise<string> {
  const res = await link.request('session.subscribe', { session }, 30_000, proof);
  if (res.type === 'err') return JSON.stringify({ error: res.code });
  return new Promise(resolve => {
    const timer = setTimeout(async () => {
      link.onFrame = undefined;
      const s = await link.request('session.get', { session }, 30_000, proof).catch(() => undefined);
      resolve(JSON.stringify({ timedOut: true, state: s && (s.body as Record<string, unknown>).state }));
    }, timeoutMs);
    const done = async (state: string) => {
      clearTimeout(timer); link.onFrame = undefined;
      await link.request('session.unsubscribe', { session }, 30_000, proof).catch(() => undefined);
      resolve(JSON.stringify({ state }));
    };
    link.onFrame = frame => {
      if (frame.type !== 'evt') return;
      const body = frame.body as Record<string, unknown>;
      if (until === 'approval' && (body.kind === 'approval_request' || body.kind === 'question_request')) void done('awaiting_approval');
      if (body.kind === 'turn_end' && until !== 'approval') void done('idle');
      if (body.kind === 'done' || (until === 'done' && body.kind === 'turn_end')) void done('done');
      if (body.kind === 'error') void done(`error:${String(body.code ?? 'unknown')}`);
    };
  });
}
