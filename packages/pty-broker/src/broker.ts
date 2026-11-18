// The shell-owning process. Line-delimited JSON over a local socket:
//   request  {id, op: open|attach|detach|write|resize|close|list|kill_device, ...}
//   reply    {id, ok: true, ...} | {id, error: {code, message}}
//   events   {ev: 'output', terminal, offset, data(base64)} | {ev: 'exit', terminal, code}
// Lifetime: started detached, outlives the daemon; exits once it has had no
// terminals and no connections for `idleMs`.
import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as pty from 'node-pty';
import { Scrollback } from './scrollback.ts';
import { defaultShell } from './shell.ts';

export interface TerminalInfo { terminal: string; cwd: string; shell: string; device: string; openedAt: number; pid: number; exited: boolean; code: number | null; offset: number }
interface Term { info: TerminalInfo; proc: pty.IPty; buf: Scrollback; readers: Set<Socket> }
export interface BrokerOptions { socketPath: string; idleMs?: number; maxPerDevice?: number; scrollbackLines?: number; onExit?: () => void }

const CHUNK = 64 * 1024;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newTerminalId = () => {
  let t = Date.now(); let time = '';
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  return `t_${time}${[...randomBytes(16)].map(b => CROCKFORD[b % 32]).join('')}`;
};

export function startBroker(opts: BrokerOptions): Promise<{ server: Server; close: () => Promise<void> }> {
  const terms = new Map<string, Term>();
  const conns = new Set<Socket>();
  const idleMs = opts.idleMs ?? 30_000;
  let idle: NodeJS.Timeout | undefined;
  const send = (s: Socket, msg: unknown) => { if (!s.destroyed) s.write(`${JSON.stringify(msg)}\n`); };
  const live = () => [...terms.values()].filter(t => !t.info.exited).length;
  const checkIdle = () => {
    clearTimeout(idle);
    if (live() === 0 && conns.size === 0) idle = setTimeout(() => void close().then(() => opts.onExit?.()), idleMs);
  };

  const open = (b: Record<string, unknown>) => {
    const device = String(b.device ?? 'local');
    const max = opts.maxPerDevice ?? 4;
    if ([...terms.values()].filter(t => !t.info.exited && t.info.device === device).length >= max) throw Object.assign(new Error(`at most ${max} terminals per device`), { code: 'terminal.limit' });
    const shell = typeof b.shell === 'string' ? b.shell : defaultShell();
    const cwd = String(b.cwd ?? process.cwd());
    const proc = pty.spawn(shell, Array.isArray(b.args) ? b.args.map(String) : [], {
      name: 'xterm-256color', cwd, cols: Number(b.cols) || 80, rows: Number(b.rows) || 24,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });
    const info: TerminalInfo = { terminal: newTerminalId(), cwd, shell, device, openedAt: Date.now(), pid: proc.pid, exited: false, code: null, offset: 0 };
    const t: Term = { info, proc, buf: new Scrollback(opts.scrollbackLines ?? 5000), readers: new Set() };
    terms.set(info.terminal, t);
    proc.onData(d => {
      const chunk = Buffer.from(d, 'utf8');
      const offset = t.buf.push(chunk); info.offset = t.buf.end;
      for (const r of t.readers) send(r, { ev: 'output', terminal: info.terminal, offset, data: chunk.toString('base64') });
    });
    proc.onExit(({ exitCode }) => {
      info.exited = true; info.code = exitCode;
      for (const r of t.readers) send(r, { ev: 'exit', terminal: info.terminal, code: exitCode });
      checkIdle();
    });
    clearTimeout(idle);
    return info;
  };

  const attach = (s: Socket, t: Term, from: number) => {
    t.readers.add(s);
    const { offset, data } = t.buf.since(from);
    for (let i = 0; i < data.length; i += CHUNK) send(s, { ev: 'output', terminal: t.info.terminal, offset: offset + i, data: data.subarray(i, i + CHUNK).toString('base64') });
    if (t.info.exited) send(s, { ev: 'exit', terminal: t.info.terminal, code: t.info.code });
  };

  const handle = (s: Socket, msg: Record<string, unknown>) => {
    const id = msg.id;
    const term = () => { const t = terms.get(String(msg.terminal)); if (!t) throw Object.assign(new Error(String(msg.terminal)), { code: 'terminal.not_found' }); return t; };
    try {
      switch (msg.op) {
        case 'open': { const info = open(msg); if (msg.attach !== false) attach(s, terms.get(info.terminal)!, 0); return send(s, { id, ok: true, ...info }); }
        case 'attach': { const t = term(); send(s, { id, ok: true, ...t.info }); return attach(s, t, Number(msg.from) || 0); }
        case 'detach': term().readers.delete(s); return send(s, { id, ok: true });
        case 'write': { const t = term(); if (!t.info.exited) t.proc.write(Buffer.from(String(msg.data), 'base64').toString('utf8')); return send(s, { id, ok: true }); }
        case 'resize': { const t = term(); if (!t.info.exited) t.proc.resize(Number(msg.cols) || 80, Number(msg.rows) || 24); return send(s, { id, ok: true }); }
        case 'close': { const t = term(); if (!t.info.exited) t.proc.kill(); terms.delete(t.info.terminal); checkIdle(); return send(s, { id, ok: true }); }
        case 'kill_device': {
          const killed = [...terms.values()].filter(t => t.info.device === msg.device);
          for (const t of killed) { if (!t.info.exited) t.proc.kill(); terms.delete(t.info.terminal); }
          checkIdle(); return send(s, { id, ok: true, killed: killed.map(t => t.info.terminal) });
        }
        case 'list': return send(s, { id, ok: true, terminals: [...terms.values()].map(t => t.info) });
        default: throw Object.assign(new Error(String(msg.op)), { code: 'terminal.bad_op' });
      }
    } catch (e) { send(s, { id, error: { code: (e as { code?: string }).code ?? 'terminal.failed', message: (e as Error).message } }); }
  };

  const server = createServer(s => {
    conns.add(s); clearTimeout(idle);
    let pending = '';
    s.setEncoding('utf8');
    s.on('data', (d: string) => {
      pending += d;
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        const line = pending.slice(0, i); pending = pending.slice(i + 1);
        try { handle(s, JSON.parse(line) as Record<string, unknown>); } catch { /* bad line */ }
      }
    });
    s.on('error', () => undefined);
    s.on('close', () => { conns.delete(s); for (const t of terms.values()) t.readers.delete(s); checkIdle(); });
  });

  const close = () => new Promise<void>(res => {
    clearTimeout(idle);
    for (const t of terms.values()) if (!t.info.exited) t.proc.kill();
    for (const c of conns) c.destroy();
    server.close(() => res());
  });

  return new Promise((res, rej) => {
    if (process.platform !== 'win32' && existsSync(opts.socketPath)) { try { unlinkSync(opts.socketPath); } catch { /* raced */ } }
    server.once('error', rej);
    server.listen(opts.socketPath, () => { checkIdle(); res({ server, close }); });
  });
}
