import net from 'node:net';
import { homedir, tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { parseWireFrame, newId, type Frame } from '@ormicode/protocol';

export function defaultSocketPath(): string {
  if (platform() === 'win32') return `\\\\.\\pipe\\ormicode-${createHash('sha256').update(homedir()).digest('hex').slice(0, 12)}`;
  return join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `ormicode-${process.getuid?.() ?? 'u'}.sock`);
}

export function ormicodeDir(): string {
  const dir = process.env.ORMICODE_HOME ?? join(homedir(), '.ormicode');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** NDJSON framing over a net socket: one JSON frame per line, 256 KiB cap from the wire spec. */
export class Link {
  private buffer = '';
  private queue: Frame[] = [];
  private waiting: ((frame: Frame | undefined) => void) | undefined;
  private pending = new Map<string, { resolve: (frame: Frame) => void; timer: NodeJS.Timeout }>();
  closed = false;
  onFrame: ((frame: Frame) => void) | undefined;
  onClose: (() => void) | undefined;

  private readonly socket: net.Socket;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.feed(String(chunk)));
    socket.on('close', () => { this.closed = true; this.onClose?.(); this.wake(undefined); });
    socket.on('error', () => { this.closed = true; });
  }

  send(frame: Frame | Record<string, unknown>): void {
    if (!this.closed) this.socket.write(JSON.stringify(frame) + '\n');
  }

  /** req -> res/err round trip with an id we mint here. */
  request(method: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<Frame> {
    const id = newId('req');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.send({ v: 1, type: 'req', id, method, body, ts: Date.now() });
    });
  }

  reply(id: string, body: Record<string, unknown>): void {
    this.send({ v: 1, type: 'res', id, ok: true, body });
  }

  replyError(id: string, code: string, message: string): void {
    this.send({ v: 1, type: 'err', id, code, message });
  }

  private feed(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 1);
      if (!line.trim()) continue;
      const parsed = parseWireFrame(line);
      if (!parsed.success) { this.wake(undefined); continue; }
      const frame = parsed.data;
      if ((frame.type === 'res' || frame.type === 'err') && this.pending.has(frame.id)) {
        const p = this.pending.get(frame.id)!;
        this.pending.delete(frame.id);
        clearTimeout(p.timer);
        p.resolve(frame);
        continue;
      }
      if (this.onFrame) this.onFrame(frame);
      else this.wake(frame);
    }
  }

  private wake(frame: Frame | undefined): void {
    const w = this.waiting;
    if (w) { this.waiting = undefined; w(frame); }
    else if (frame) this.queue.push(frame);
  }

  /** Next inbound frame, or undefined on close. Used by peers that poll. */
  next(): Promise<Frame | undefined> {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.resolve(undefined);
    return new Promise(resolve => { this.waiting = resolve; });
  }

  close(): void { this.socket.destroy(); }
}

/** `host:port` or a bare port means TCP loopback; anything else is a unix socket / named pipe. */
function tcpTarget(path: string): { host: string; port: number } | undefined {
  const bare = /^\d+$/.exec(path);
  if (bare) return { host: '127.0.0.1', port: Number(path) };
  const hp = /^127\.0\.0\.1:(\d+)$|^localhost:(\d+)$/.exec(path);
  return hp ? { host: '127.0.0.1', port: Number(hp[1] ?? hp[2]) } : undefined;
}

export function connect(path: string, hello?: Record<string, unknown>): Promise<Link> {
  return new Promise((resolve, reject) => {
    const target = tcpTarget(path);
    const socket = target ? net.connect(target.port, target.host) : net.connect(path);
    socket.once('connect', () => {
      const link = new Link(socket);
      if (hello) link.send(hello);
      resolve(link);
    });
    socket.once('error', reject);
  });
}

export function serve(path: string, onLink: (link: Link) => void): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => onLink(new Link(socket)));
    server.once('error', reject);
    const target = tcpTarget(path);
    if (target) server.listen(target.port, target.host, () => resolve(server));
    else server.listen(path, () => resolve(server));
  });
}
