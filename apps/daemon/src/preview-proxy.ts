import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import type { Duplex } from 'node:stream';
import { PreviewInspector, previewInspectorScript } from './preview-inspector.ts';

interface Target { session: string; port: number; base: number; token: string; detected: boolean }
const HTML_CAP = 5 * 1024 * 1024;
const REPORT_CAP = 64 * 1024;

function token(): string { return randomBytes(24).toString('base64url'); }
function targetKey(session: string, port: number): string { return `${session}:${port}`; }

export function previewLabel(session: string, port: number): string {
  const short = session.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-10) || 'session';
  return `${short}-${port}`.slice(0, 63);
}

function sameToken(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function cookieValue(header: string | undefined): string | undefined {
  return header?.split(';').map(value => value.trim()).find(value => value.startsWith('__ormi_preview='))?.slice('__ormi_preview='.length);
}

function stripPreviewCookie(header: string | undefined): string | undefined {
  const kept = header?.split(';').map(value => value.trim()).filter(value => value && !value.startsWith('__ormi_preview='));
  return kept?.length ? kept.join('; ') : undefined;
}

function page(status: number, title: string, message: string): { status: number; body: string } {
  return { status, body: `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${message}</p>` };
}

export class PreviewProxy {
  private readonly server: Server;
  readonly inspector = new PreviewInspector();
  private readonly targets = new Map<string, Target>();
  private readonly sockets = new Set<Duplex>();
  private portValue = 0;

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
  }

  get port(): number { return this.portValue; }

  async listen(): Promise<number> {
    const configured = process.env.ORMICODE_PREVIEW_PORT;
    const port = configured === undefined ? 0 : Number(configured);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid ORMICODE_PREVIEW_PORT');
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        const address = this.server.address();
        if (!address || typeof address === 'string') return reject(new Error('preview proxy did not bind TCP'));
        this.portValue = address.port;
        resolve();
      });
    });
    console.info(`Preview proxy listening on 127.0.0.1:${this.portValue}`);
    return this.portValue;
  }

  register(session: string, base: number, port: number, detected = false): void {
    if (port < base || port >= base + 10) throw new Error('preview port outside session block');
    const key = targetKey(session, port);
    const current = this.targets.get(key);
    if (current) { current.detected ||= detected; return; }
    this.targets.set(key, { session, port, base, token: token(), detected });
  }

  rotate(session: string, base: number, port: number): void {
    this.register(session, base, port);
    const target = this.targets.get(targetKey(session, port))!;
    target.token = token();
    target.detected = false;
  }

  origin(session: string, port: number): string {
    return `http://${previewLabel(session, port)}.localhost:${this.portValue}`;
  }

  url(session: string, base: number, port: number, path = '/'): string {
    this.register(session, base, port);
    const target = this.targets.get(targetKey(session, port))!;
    const to = path.startsWith('/') && !path.startsWith('//') ? path : '/';
    const auth = new URL('/__ormi/auth', this.origin(session, port));
    auth.searchParams.set('t', target.token);
    auth.searchParams.set('to', to);
    return auth.toString();
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.server.closeAllConnections();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  private route(req: IncomingMessage): Target | undefined {
    if (!req.headers.host) return undefined;
    let parsed: URL;
    try { parsed = new URL(`http://${req.headers.host}`); }
    catch { return undefined; }
    if (Number(parsed.port) !== this.portValue) return undefined;
    const hostname = parsed.hostname.toLowerCase();
    return [...this.targets.values()].find(target => `${previewLabel(target.session, target.port)}.localhost` === hostname);
  }

  private authorized(req: IncomingMessage, target: Target): boolean {
    return sameToken(cookieValue(req.headers.cookie), target.token);
  }

  console(session: string, after?: number, limit?: number) {
    return this.inspector.list(session, after, limit);
  }

  clearConsole(session: string): void { this.inspector.clear(session); }
  consoleEntries(session: string, ids: string[]) { return this.inspector.forPrompt(session, ids); }

  private handleAuth(req: IncomingMessage, res: ServerResponse, target: Target): void {
    let parsed: URL;
    try { parsed = new URL(req.url ?? '/', 'http://preview.local'); }
    catch { res.writeHead(400).end(); return; }
    const to = parsed.searchParams.get('to') ?? '';
    if (req.method !== 'GET' || !sameToken(parsed.searchParams.get('t') ?? undefined, target.token)
        || !to.startsWith('/') || to.startsWith('//') || /[\r\n]/.test(to)) {
      const denied = page(403, 'Preview access denied', 'Preview access denied');
      res.writeHead(denied.status, { 'content-type': 'text/html; charset=utf-8' }).end(denied.body);
      return;
    }
    res.writeHead(302, {
      location: to,
      'set-cookie': `__ormi_preview=${target.token}; HttpOnly; SameSite=Lax; Path=/`,
    }).end();
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const target = this.route(req);
    if (!target) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    let pathname = '/';
    try { pathname = new URL(req.url ?? '/', 'http://preview.local').pathname; } catch { /* handled upstream as not found */ }
    if (pathname === '/__ormi/auth') return this.handleAuth(req, res, target);
    if (!this.authorized(req, target)) {
      const denied = page(403, 'Preview access required', 'Open this preview from OrmiCode to authorize it.');
      res.writeHead(denied.status, { 'content-type': 'text/html; charset=utf-8' }).end(denied.body);
      return;
    }
    if (pathname === '/__ormi/inspect.js') {
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(previewInspectorScript);
      return;
    }
    if (pathname === '/__ormi/report') {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      void this.handleReport(req, res, target);
      return;
    }
    const headers: OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${target.port}` };
    if (req.headers.origin) headers.origin = `http://127.0.0.1:${target.port}`;
    const htmlRequest = Boolean(req.headers.accept?.toLowerCase().includes('text/html'));
    if (htmlRequest) headers['accept-encoding'] = 'identity';
    const cookie = stripPreviewCookie(req.headers.cookie);
    if (cookie) headers.cookie = cookie; else delete headers.cookie;
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-forwarded-proto'] = 'http';
    const upstream = httpRequest({
      hostname: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers,
    }, response => {
      const outgoing = { ...response.headers };
      if (typeof outgoing.location === 'string') outgoing.location = this.rewriteLocation(outgoing.location, target);
      const contentType = response.headers['content-type'];
      const inject = req.method === 'GET' && htmlRequest && (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300
        && typeof contentType === 'string' && contentType.toLowerCase().includes('text/html')
        && (!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity');
      if (inject) this.injectHtml(response, res);
      else { res.writeHead(response.statusCode ?? 502, outgoing); response.pipe(res); }
    });
    upstream.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      const down = page(502, 'Service not running', 'Service not running');
      res.writeHead(down.status, { 'content-type': 'text/html; charset=utf-8' }).end(down.body);
    });
    req.pipe(upstream);
  }

  private async handleReport(req: IncomingMessage, res: ServerResponse, target: Target): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > REPORT_CAP) tooLarge = true;
      else if (!tooLarge) chunks.push(bytes);
    }
    if (tooLarge) { res.writeHead(413).end(); return; }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { res.writeHead(400).end(); return; }
    if (!body || typeof body !== 'object' || !Array.isArray((body as { entries?: unknown }).entries)
      || (body as { entries: unknown[] }).entries.length > 50) {
      res.writeHead(400).end();
      return;
    }
    const result = this.inspector.report(target.session, target.port, body);
    res.writeHead(204, { 'cache-control': 'no-store', 'x-ormi-dropped': String(result.dropped) }).end();
  }

  private injectHtml(response: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    let size = 0;
    let passthrough = false;
    const headers = { ...response.headers };
    response.on('data', (chunk: Buffer) => {
      if (passthrough) { res.write(chunk); return; }
      size += chunk.length;
      if (size <= HTML_CAP) { chunks.push(chunk); return; }
      passthrough = true;
      res.writeHead(response.statusCode ?? 502, headers);
      res.write(Buffer.concat([...chunks, chunk]));
      chunks.length = 0;
    });
    response.on('end', () => {
      if (passthrough) { res.end(); return; }
      const body = Buffer.concat(chunks);
      const html = body.toString('latin1');
      const head = /<head\b[^>]*>/i.exec(html);
      const offset = head ? head.index + head[0].length : 0;
      const script = Buffer.from('<script src="/__ormi/inspect.js"></script>', 'ascii');
      const output = Buffer.concat([body.subarray(0, offset), script, body.subarray(offset)]);
      delete headers['content-length'];
      delete headers.etag;
      res.writeHead(response.statusCode ?? 200, headers);
      res.end(output);
    });
    response.on('error', () => res.destroy());
  }

  private rewriteLocation(location: string, target: Target): string {
    const localOrigin = new RegExp(`^http://(?:127\\.0\\.0\\.1|localhost):${target.port}(?=/|\\?|#|$)`, 'i');
    return location.replace(localOrigin, this.origin(target.session, target.port));
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const target = this.route(req);
    if (!target) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    if (!this.authorized(req, target)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstream = createConnection(target.port, '127.0.0.1');
    upstream.once('connect', () => {
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/${req.httpVersion}`];
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined || key === 'host' || key === 'origin' || key === 'cookie') continue;
        lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
      }
      lines.push(`host: 127.0.0.1:${target.port}`);
      if (req.headers.origin) lines.push(`origin: http://127.0.0.1:${target.port}`);
      const cookie = stripPreviewCookie(req.headers.cookie);
      if (cookie) lines.push(`cookie: ${cookie}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.once('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
    socket.once('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
  }
}
