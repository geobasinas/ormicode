import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import type { RawLog } from '@ormicode/agent-core';
import * as z from 'zod/mini';

export type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const id = z.union([z.string(), z.number().check(z.int())]);
const frame = z.union([
  z.looseObject({ jsonrpc: z.literal('2.0'), id, method: z.string(), params: z.optional(z.json()) }).check(z.refine(value => !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error'))),
  z.looseObject({ jsonrpc: z.literal('2.0'), method: z.string(), params: z.optional(z.json()) }).check(z.refine(value => !Object.hasOwn(value, 'id'))),
  z.looseObject({ jsonrpc: z.literal('2.0'), id, result: z.json() }).check(z.refine(value => !Object.hasOwn(value, 'error') && !Object.hasOwn(value, 'method'))),
  z.looseObject({ jsonrpc: z.literal('2.0'), id, error: z.looseObject({ code: z.number().check(z.int()), message: z.string(), data: z.optional(z.json()) }) }).check(z.refine(value => !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'method'))),
]);
const limit = 1024 * 1024;

export class AcpError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) { super(`ACP error ${code}: ${message}`); this.code = code; this.data = data; }
}

/** Shared bounded JSON-RPC stdio framing. Version-agnostic; protocol profiles layer v1/v2 semantics on top. */
export class JsonRpcPeer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onNotification?: (method: string, params: unknown) => void;
  private readonly onRequest?: (method: string, params: unknown) => Promise<unknown>;
  private readonly log?: RawLog;
  private readonly pending = new Map<string | number, Pending>();
  private nextId = 0;
  private closed = false;
  constructor(child: ChildProcessWithoutNullStreams, onNotification?: (method: string, params: unknown) => void, onRequest?: (method: string, params: unknown) => Promise<unknown>, log?: RawLog) {
    this.child = child; this.onNotification = onNotification; this.onRequest = onRequest; this.log = log;
    child.stderr.on('data', (chunk: Buffer) => this.log?.err(chunk));
    if (!log) child.stderr.resume();
    child.stdin.on('error', () => this.close('ACP input failed'));
    child.once('error', () => this.close('ACP process failed'));
    child.once('close', code => { this.log?.meta({ exitCode: code }); this.close('ACP process closed'); });
    void this.read();
  }
  static spawnPeer(options: { executable: string; args: string[]; cwd?: string; spawn?: Spawn; log?: RawLog; onNotification?: (method: string, params: unknown) => void; onRequest?: (method: string, params: unknown) => Promise<unknown> }): JsonRpcPeer {
    const child = (options.spawn ?? spawn)(options.executable, options.args, { cwd: options.cwd, windowsHide: true, shell: false });
    options.log?.meta({ command: [options.executable, ...options.args].join(' '), cwd: options.cwd });
    return new JsonRpcPeer(child, options.onNotification, options.onRequest, options.log);
  }
  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('ACP connection is closed'));
    if (!method || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647 || !z.safeParse(z.json(), params).success) return Promise.reject(new Error('Invalid ACP request'));
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`ACP request timed out: ${method}`)); }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id: requestId, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error instanceof Error ? error : new Error('ACP write failed')); }
    });
  }
  notify(method: string, params: unknown): void {
    if (!method || !z.safeParse(z.json(), params).success) throw new Error('Invalid ACP notification');
    this.send({ jsonrpc: '2.0', method, params });
  }
  /** Reply to an agent-initiated request. Unknown client methods fail closed. */
  async respond(requestId: string | number, method: string, params: unknown): Promise<void> {
    try {
      if (method !== 'session/request_permission') {
        this.send({ jsonrpc: '2.0', id: requestId, error: { code: -32601, message: 'Client method not supported' } });
        return;
      }
      let result: unknown = { outcome: { outcome: 'cancelled' } };
      try { if (this.onRequest) result = await this.onRequest(method, params); } catch { /* Cancel if the handler fails. */ }
      if (!z.safeParse(z.json(), result).success) result = { outcome: { outcome: 'cancelled' } };
      if (!this.closed) this.send({ jsonrpc: '2.0', id: requestId, result });
    } catch { this.close('ACP response failed'); }
  }
  close(reason = 'ACP connection closed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(reason)); }
    this.pending.clear(); this.child.stdin.end(); this.child.kill();
  }
  private send(value: unknown): void {
    const line = `${JSON.stringify(value)}\n`;
    if (this.closed || this.child.stdin.destroyed || Buffer.byteLength(line) + this.child.stdin.writableLength > limit) throw new Error('ACP input unavailable or backpressured');
    this.child.stdin.write(line);
  }
  private async read(): Promise<void> {
    let buffer = Buffer.alloc(0);
    try {
      for await (const chunk of this.child.stdout) {
        this.log?.out(chunk);
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline: number;
        while ((newline = buffer.indexOf(10)) !== -1) {
          const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
          if (line.length > limit) throw new Error('ACP frame exceeds size limit');
          if (line.length) this.receive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
        }
        if (buffer.length > limit) throw new Error('ACP frame exceeds size limit');
      }
      if (buffer.length && !this.closed) throw new Error('Truncated ACP frame');
    } catch { this.close('Invalid or incomplete ACP stream'); }
  }
  private receive(input: unknown): void {
    const message = z.parse(frame, input);
    if ('method' in message && typeof message.method === 'string') {
      if ('id' in message) void this.respond(z.parse(id, message.id), message.method, message.params);
      else this.onNotification?.(message.method, message.params);
      return;
    }
    const responseId = z.parse(id, message.id);
    const entry = this.pending.get(responseId);
    if (!entry) return;
    this.pending.delete(responseId); clearTimeout(entry.timer);
    if ('error' in message) {
      const error = message.error as { code: number; message: string; data?: unknown };
      entry.reject(new AcpError(error.code, error.message, error.data));
    } else entry.resolve(message.result);
  }
}
