import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import * as z from 'zod/mini';
import type { RawLog } from '@ormicode/agent-core';
import { parseOptions, parseModes , type AcpMcpServer } from './options.ts';
import type { ConfigOption, Mode } from './options.ts';
export interface AcpBootstrap { sessionId: string; options: ConfigOption[]; modes: Mode[]; currentMode?: string }
import { attachRawLog } from '@ormicode/agent-core';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const id = z.union([z.string(), z.number().check(z.int())]);
const frame = z.union([
  z.looseObject({ jsonrpc: z.literal('2.0'), id, method: z.string(), params: z.optional(z.json()) }).check(z.refine(value => !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error'))),
  z.looseObject({ jsonrpc: z.literal('2.0'), method: z.string(), params: z.optional(z.json()) }).check(z.refine(value => !Object.hasOwn(value, 'id'))),
  z.looseObject({ jsonrpc: z.literal('2.0'), id, result: z.json() }).check(z.refine(value => !Object.hasOwn(value, 'error') && !Object.hasOwn(value, 'method'))),
  z.looseObject({ jsonrpc: z.literal('2.0'), id, error: z.looseObject({ code: z.number().check(z.int()), message: z.string() }) }).check(z.refine(value => !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'method'))),
]);
const limit = 1024 * 1024;

/** A bounded ACP v1 stdio connection. Unsupported client requests fail closed. */
export class AcpConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onNotification?: (method: string, params: unknown) => void;
  private readonly onRequest?: (method: string, params: unknown) => Promise<unknown>;
  private readonly log?: RawLog;
  private readonly pending = new Map<string | number, Pending>();
  private nextId = 0;
  private closed = false;
  private supportsLoadSession = false;
  private constructor(child: ChildProcessWithoutNullStreams, onNotification?: (method: string, params: unknown) => void, onRequest?: (method: string, params: unknown) => Promise<unknown>, log?: RawLog) {
    this.child = child; this.onNotification = onNotification; this.onRequest = onRequest; this.log = log;
    if (log) child.stderr.on('data', (chunk: Buffer) => log.err(chunk)); else child.stderr.resume();
    child.stdin.on('error', () => this.close('ACP input failed'));
    child.once('error', () => this.close('ACP process failed'));
    child.once('close', () => this.close('ACP process closed'));
    void this.read();
  }
  static async start(options: { executable: string; args: string[]; cwd?: string; spawn?: Spawn; log?: RawLog; onNotification?: (method: string, params: unknown) => void; onRequest?: (method: string, params: unknown) => Promise<unknown> }): Promise<AcpConnection> {
    const child = (options.spawn ?? spawn)(options.executable, options.args, { cwd: options.cwd, windowsHide: true, shell: false });
    attachRawLog(child, options.log, [options.executable, ...options.args].join(' '), options.cwd);
    const connection = new AcpConnection(child, options.onNotification, options.onRequest, options.log);
    try {
      const result = await connection.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'ormicode', version: '0.0.0' } });
      const parsed = z.safeParse(z.looseObject({ protocolVersion: z.literal(1), agentCapabilities: z.optional(z.looseObject({ loadSession: z.optional(z.boolean()) })) }), result);
      if (!parsed.success) throw new Error('Unsupported or invalid ACP version');
      connection.supportsLoadSession = parsed.data.agentCapabilities?.loadSession === true;
      return connection;
    } catch (error) { connection.close(); throw error; }
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
  async newSession(cwd: string, mcpServers: AcpMcpServer[] = []): Promise<AcpBootstrap> {
    if (!cwd) throw new Error('cwd is required');
    return this.bootstrap(await this.request('session/new', { cwd, mcpServers }), 'session/new');
  }
  async loadSession(sessionId: string, cwd: string, mcpServers: AcpMcpServer[] = []): Promise<AcpBootstrap> {
    if (!sessionId || !cwd) throw new Error('session ID and cwd are required');
    if (!this.supportsLoadSession) throw new Error('Vibe did not advertise session loading');
    return this.bootstrap(await this.request('session/load', { sessionId, cwd, mcpServers }), 'session/load', sessionId);
  }
  private async bootstrap(result: unknown, method: string, expectedId?: string): Promise<AcpBootstrap> {
    const parsed = z.safeParse(z.looseObject({ sessionId: z.optional(z.string()), configOptions: z.optional(z.json()), modes: z.optional(z.json()) }), result);
    const sessionId = parsed.success ? (parsed.data?.sessionId ?? expectedId) : undefined;
    if (!sessionId || (expectedId && parsed.data?.sessionId !== undefined && parsed.data.sessionId !== expectedId)) throw new Error(`Invalid ACP ${method} response`);
    const { modes, currentMode } = parseModes(parsed.data?.modes);
    return { sessionId, options: parseOptions(parsed.data?.configOptions), modes, ...(currentMode !== undefined ? { currentMode } : {}) };
  }
  /** Applies one advertised config option; returns the agent's refreshed option list. */
  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<ConfigOption[]> {
    const result = await this.request('session/set_config_option', { sessionId, configId, value });
    const parsed = z.safeParse(z.looseObject({ configOptions: z.optional(z.json()) }), result);
    return parseOptions(parsed.success ? parsed.data.configOptions : undefined);
  }
  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.request('session/set_mode', { sessionId, modeId });
  }
  async prompt(sessionId: string, text: string, timeoutMs = 300_000): Promise<string> {
    if (!sessionId || !text) throw new Error('session ID and prompt are required');
    const result = await this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, timeoutMs);
    const parsed = z.safeParse(z.looseObject({ stopReason: z.string().check(z.minLength(1)) }), result);
    if (!parsed.success) throw new Error('Invalid ACP session/prompt response');
    return parsed.data.stopReason;
  }
  cancel(sessionId: string): void {
    if (!sessionId) throw new Error('session ID is required');
    this.notify('session/cancel', { sessionId });
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
      if ('id' in message) {
        void this.respond(z.parse(id, message.id), message.method, message.params);
      } else this.onNotification?.(message.method, message.params);
      return;
    }
    const responseId = z.parse(id, message.id);
    const entry = this.pending.get(responseId);
    if (!entry) return;
    this.pending.delete(responseId); clearTimeout(entry.timer);
    if ('error' in message) {
      const error = message.error as { code: number; message: string };
      entry.reject(new Error(`ACP error ${error.code}: ${error.message}`));
    } else entry.resolve(message.result);
  }
  private async respond(requestId: string | number, method: string, params: unknown): Promise<void> {
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
}
