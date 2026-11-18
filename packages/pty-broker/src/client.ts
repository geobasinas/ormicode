// Daemon-side connection to the broker. `ensureBroker` connects, or starts
// the broker as a detached process (so daemon restarts leave shells alive).
import { connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface BrokerEvent { ev: 'output' | 'exit'; terminal: string; offset?: number; data?: string; code?: number | null }
type Reply = Record<string, unknown> & { error?: { code: string; message: string } };

export class BrokerClient {
  private readonly sock: Socket;
  private next = 1;
  private readonly waiting = new Map<number, (r: Reply) => void>();
  onEvent: ((e: BrokerEvent) => void) | undefined;
  onClose: (() => void) | undefined;
  constructor(sock: Socket) {
    this.sock = sock;
    let pending = '';
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => {
      pending += d;
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        const msg = JSON.parse(pending.slice(0, i)) as Reply; pending = pending.slice(i + 1);
        if (typeof msg.id === 'number') { this.waiting.get(msg.id)?.(msg); this.waiting.delete(msg.id); }
        else this.onEvent?.(msg as unknown as BrokerEvent);
      }
    });
    sock.on('error', () => undefined);
    sock.on('close', () => {
      for (const w of this.waiting.values()) w({ error: { code: 'terminal.broker_gone', message: 'pty broker connection closed' } });
      this.waiting.clear(); this.onClose?.();
    });
  }
  get closed(): boolean { return this.sock.destroyed; }
  request(op: string, body: Record<string, unknown> = {}): Promise<Reply> {
    const id = this.next++;
    return new Promise(res => { this.waiting.set(id, res); this.sock.write(`${JSON.stringify({ id, op, ...body })}\n`); });
  }
  close(): void { this.sock.destroy(); }
}

export function connectBroker(socketPath: string): Promise<BrokerClient> {
  return new Promise((res, rej) => {
    const s = connect(socketPath);
    s.once('connect', () => { s.removeListener('error', rej); res(new BrokerClient(s)); });
    s.once('error', rej);
  });
}

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

export async function ensureBroker(socketPath: string, env: NodeJS.ProcessEnv = process.env): Promise<BrokerClient> {
  try { return await connectBroker(socketPath); } catch { /* start it */ }
  const child = spawn(process.execPath, [MAIN], { detached: true, stdio: 'ignore', env: { ...env, ORMICODE_PTY_SOCKET: socketPath }, windowsHide: true });
  child.unref();
  const end = Date.now() + 5000;
  for (;;) {
    try { return await connectBroker(socketPath); } catch (e) { if (Date.now() > end) throw e; }
    await new Promise(r => setTimeout(r, 50));
  }
}
