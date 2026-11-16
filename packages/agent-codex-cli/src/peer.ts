import * as z from 'zod/mini';
import { rpcFrameSchema } from './rpc.ts';
import type { RpcFrame } from './rpc.ts';

type Id = string | number;
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Request correlation only. The caller owns the process and supplies a trusted transport. */
export class RpcPeer {
  private serial = 0;
  private pending = new Map<Id, Pending>();
  private closed = false;
  private readonly send: (line: string) => void;
  private readonly onRequest?: (method: string, params: unknown) => Promise<unknown>;
  private readonly onNotification?: (method: string, params: unknown) => void;
  constructor(options: { send: (line: string) => void; onRequest?: (method: string, params: unknown) => Promise<unknown>; onNotification?: (method: string, params: unknown) => void }) {
    this.send = options.send; this.onRequest = options.onRequest; this.onNotification = options.onNotification;
  }
  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('RPC peer is closed'));
    if (!method || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) return Promise.reject(new Error('Invalid RPC request'));
    const safeParams = z.safeParse(z.json(), params);
    if (!safeParams.success) return Promise.reject(new Error('RPC params must be JSON'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC request timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send(`${JSON.stringify({ id, method, params: safeParams.data })}\n`); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error('RPC send failed')); }
    });
  }
  notify(method: string, params: unknown): void {
    if (this.closed) throw new Error('RPC peer is closed');
    const safe = z.safeParse(z.json(), params);
    if (!method || !safe.success) throw new Error('Invalid RPC notification');
    this.send(`${JSON.stringify({ method, params: safe.data })}\n`);
  }
  async receive(input: unknown): Promise<void> {
    const parsed = z.safeParse(rpcFrameSchema, input);
    if (!parsed.success) throw new Error('Invalid RPC frame');
    const frame: RpcFrame = parsed.data;
    if ('method' in frame && typeof frame.method === 'string') {
      if (!('id' in frame)) { this.onNotification?.(frame.method, frame.params); return; }
      try {
        if (!this.onRequest) throw new Error('Unsupported server request');
        const result = await this.onRequest(frame.method, frame.params);
        const safe = z.safeParse(z.json(), result);
        if (!safe.success) throw new Error('Invalid server-request response');
        if (!this.closed) this.send(`${JSON.stringify({ id: frame.id, result: safe.data })}\n`);
      } catch {
        if (!this.closed) this.send(`${JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Server request unsupported or failed' } })}\n`);
      }
      return;
    }
    if (typeof frame.id !== 'string' && typeof frame.id !== 'number') return;
    const pending = this.pending.get(frame.id);
    if (!pending) return; // Timed-out and duplicate responses are ignored.
    this.pending.delete(frame.id); clearTimeout(pending.timer);
    if ('error' in frame) {
      const error = frame.error as { code: number; message: string };
      pending.reject(new Error(`RPC error ${error.code}: ${error.message}`));
    }
    else pending.resolve(frame.result);
  }
  close(reason = 'RPC peer closed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)); }
    this.pending.clear();
  }
}
