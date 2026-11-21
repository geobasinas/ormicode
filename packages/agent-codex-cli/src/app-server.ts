import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { attachRawLog } from '@ormicode/agent-core';
import type { RawLog } from '@ormicode/agent-core';
import { RpcLineDecoder } from './rpc.ts';
import { RpcPeer } from './peer.ts';
import * as z from 'zod/mini';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** Owns one app-server process. */
export class CodexAppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly peer: RpcPeer;
  private readonly log?: RawLog;
  private closing = false;
  /** Effective model from the last thread/start or thread/resume response. */
  model?: string;
  private constructor(child: ChildProcessWithoutNullStreams, handlers: { onNotification?: (method: string, params: unknown) => void; onRequest?: (method: string, params: unknown) => Promise<unknown>; log?: RawLog }) {
    this.child = child;
    this.log = handlers.log;
    this.peer = new RpcPeer({
      send: (line) => {
        if (child.stdin.destroyed || child.stdin.writableLength + Buffer.byteLength(line) > 1024 * 1024) throw new Error('App-server input is unavailable or backpressured');
        child.stdin.write(line);
      },
      onRequest: handlers.onRequest,
      onNotification: handlers.onNotification,
    });
    attachRawLog(child, this.log);
    child.stderr.resume();
    child.stdin.on('error', () => this.peer.close('App-server input closed'));
    child.once('error', () => this.peer.close('App-server process failed'));
    child.once('close', () => this.peer.close('App-server process closed'));
    void this.read();
  }
  static async start(options: { executable?: string; cwd?: string; spawn?: Spawn; log?: RawLog; onNotification?: (method: string, params: unknown) => void; onRequest?: (method: string, params: unknown) => Promise<unknown> } = {}): Promise<CodexAppServer> {
    const child = (options.spawn ?? spawn)(options.executable ?? 'codex', ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, windowsHide: true, shell: false });
    const server = new CodexAppServer(child, options);
    server.log?.meta({ command: 'codex app-server', cwd: options.cwd });
    try {
      const response = await server.peer.request('initialize', { clientInfo: { name: 'ormicode', title: 'ormicode', version: '0.0.0' }, capabilities: null });
      const schema = z.looseObject({ userAgent: z.string(), codexHome: z.string(), platformFamily: z.string(), platformOs: z.string() });
      if (!z.safeParse(schema, response).success) throw new Error('Invalid app-server initialize response');
      server.peer.notify('initialized', {});
      return server;
    } catch (error) { server.close(); throw error; }
  }
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> { return this.peer.request(method, params, timeoutMs); }
  async startThread(options: { cwd: string; model?: string; sandbox?: string; approvalPolicy?: string }): Promise<string> {
    if (!options.cwd) throw new Error('cwd is required');
    return this.threadRequest('thread/start', { cwd: options.cwd, approvalPolicy: options.approvalPolicy ?? 'on-request', sandbox: options.sandbox ?? 'workspace-write', ...(options.model ? { model: options.model } : {}) });
  }
  async resumeThread(options: { threadId: string; cwd: string; model?: string; sandbox?: string; approvalPolicy?: string }): Promise<string> {
    if (!options.cwd || !options.threadId) throw new Error('cwd and thread ID are required');
    const id = await this.threadRequest('thread/resume', { threadId: options.threadId, cwd: options.cwd, approvalPolicy: options.approvalPolicy ?? 'on-request', sandbox: options.sandbox ?? 'workspace-write', ...(options.model ? { model: options.model } : {}) });
    if (id !== options.threadId) throw new Error('App-server returned a different thread ID');
    return id;
  }
  private async threadRequest(method: string, params: unknown): Promise<string> {
    const response = await this.request(method, params);
    const parsed = z.safeParse(z.looseObject({ thread: z.looseObject({ id: z.string().check(z.minLength(1)) }), model: z.optional(z.string()) }), response);
    if (!parsed.success) throw new Error(`Invalid ${method} response`);
    this.model = parsed.data.model || undefined;
    return parsed.data.thread.id;
  }
  /** Extra turn params (model, effort, outputSchema, sandboxPolicy) apply to this turn only. */
  async startTurn(threadId: string, text: string, extra: Record<string, unknown> = {}): Promise<string> {
    if (!threadId || !text) throw new Error('thread ID and prompt are required');
    const response = await this.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }], ...extra });
    const parsed = z.safeParse(z.looseObject({ turn: z.looseObject({ id: z.string().check(z.minLength(1)) }) }), response);
    if (!parsed.success) throw new Error('Invalid turn/start response');
    return parsed.data.turn.id;
  }
  async steerTurn(threadId: string, turnId: string, text: string): Promise<void> {
    if (!threadId || !turnId || !text) throw new Error('thread ID, turn ID and text are required');
    await this.request('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text, text_elements: [] }] });
  }
  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    if (!threadId || !turnId) throw new Error('thread ID and turn ID are required');
    await this.request('turn/interrupt', { threadId, turnId });
  }
  async models(): Promise<readonly { id: string; name?: string; efforts?: string[] }[]> {
    const response = await this.request('model/list', {});
    const parsed = z.safeParse(z.looseObject({ data: z.array(z.looseObject({ id: z.string().check(z.minLength(1)), displayName: z.optional(z.string()), supportedReasoningEfforts: z.optional(z.array(z.looseObject({ reasoningEffort: z.string() }))) })) }), response);
    if (!parsed.success) throw new Error('Invalid model/list response');
    return parsed.data.data.filter((model) => !('hidden' in model) || !model.hidden).map((model) => ({ id: model.id, ...(model.displayName ? { name: model.displayName } : {}), ...(model.supportedReasoningEfforts?.length ? { efforts: model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort) } : {}) }));
  }
  /** The `model` the user's config selects; usable even when the picker catalog does not advertise it. */
  async configuredModel(): Promise<string | undefined> {
    const response = await this.request('config/read', {});
    const parsed = z.safeParse(z.looseObject({ config: z.optional(z.looseObject({ model: z.optional(z.string()) })) }), response);
    if (!parsed.success) throw new Error('Invalid config/read response');
    return parsed.data.config?.model || undefined;
  }
  close(): void {
    if (this.closing) return;
    this.closing = true; this.peer.close(); this.child.stdin.end(); this.child.kill();
  }
  private async read(): Promise<void> {
    const decoder = new RpcLineDecoder();
    try {
      for await (const chunk of this.child.stdout) {
        this.log?.out(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        for (const frame of decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)) void this.peer.receive(frame).catch(() => this.close());
      }
      if (!this.closing) decoder.finish();
    } catch { if (!this.closing) this.close(); }
  }
}
