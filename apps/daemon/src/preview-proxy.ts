import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import type { Duplex } from 'node:stream';

interface Target { session: string; port: number; base: number; token: string; detected: boolean }

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
    if ((req.url ?? '').startsWith('/__ormi/auth')) return this.handleAuth(req, res, target);
    if (!this.authorized(req, target)) {
      const denied = page(403, 'Preview access required', 'Open this preview from OrmiCode to authorize it.');
      res.writeHead(denied.status, { 'content-type': 'text/html; charset=utf-8' }).end(denied.body);
      return;
    }
    const headers: OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${target.port}` };
    if (req.headers.origin) headers.origin = `http://127.0.0.1:${target.port}`;
    const cookie = stripPreviewCookie(req.headers.cookie);
    if (cookie) headers.cookie = cookie; else delete headers.cookie;
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-forwarded-proto'] = 'http';
    const upstream = httpRequest({
      hostname: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers,
    }, response => {
      const outgoing = { ...response.headers };
      if (typeof outgoing.location === 'string') outgoing.location = this.rewriteLocation(outgoing.location, target);
      res.writeHead(response.statusCode ?? 502, outgoing);
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      const down = page(502, 'Service not running', 'Service not running');
      res.writeHead(down.status, { 'content-type': 'text/html; charset=utf-8' }).end(down.body);
    });
    req.pipe(upstream);
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
