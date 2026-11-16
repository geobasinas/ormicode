import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { RpcLineDecoder } from './rpc.ts';
import { RpcPeer } from './peer.ts';
import * as z from 'zod/mini';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** Owns one app-server process. Approval forwarding is not implemented. */
export class CodexAppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly peer: RpcPeer;
  private closing = false;
  private constructor(child: ChildProcessWithoutNullStreams, onNotification?: (method: string, params: unknown) => void) {
    this.child = child;
    this.peer = new RpcPeer({
      send: (line) => {
        if (child.stdin.destroyed || child.stdin.writableLength + Buffer.byteLength(line) > 1024 * 1024) throw new Error('App-server input is unavailable or backpressured');
        child.stdin.write(line);
      },
      onNotification,
    });
    child.stderr.resume();
    child.stdin.on('error', () => this.peer.close('App-server input closed'));
    child.once('error', () => this.peer.close('App-server process failed'));
    child.once('close', () => this.peer.close('App-server process closed'));
    void this.read();
  }
  static async start(options: { executable?: string; cwd?: string; spawn?: Spawn; onNotification?: (method: string, params: unknown) => void } = {}): Promise<CodexAppServer> {
    const child = (options.spawn ?? spawn)(options.executable ?? 'codex', ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, windowsHide: true, shell: false });
    const server = new CodexAppServer(child, options.onNotification);
    try {
      const response = await server.peer.request('initialize', { clientInfo: { name: 'ormicode', title: 'ormicode', version: '0.0.0' }, capabilities: null });
      const schema = z.looseObject({ userAgent: z.string(), codexHome: z.string(), platformFamily: z.string(), platformOs: z.string() });
      if (!z.safeParse(schema, response).success) throw new Error('Invalid app-server initialize response');
      server.peer.notify('initialized', {});
      return server;
    } catch (error) { server.close(); throw error; }
  }
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> { return this.peer.request(method, params, timeoutMs); }
  async startThread(options: { cwd: string; model?: string }): Promise<string> {
    if (!options.cwd) throw new Error('cwd is required');
    return this.threadRequest('thread/start', { ...options, approvalPolicy: 'never', sandbox: 'read-only' });
  }
  async resumeThread(options: { threadId: string; cwd: string; model?: string }): Promise<string> {
    if (!options.cwd || !options.threadId) throw new Error('cwd and thread ID are required');
    const id = await this.threadRequest('thread/resume', { ...options, approvalPolicy: 'never', sandbox: 'read-only' });
    if (id !== options.threadId) throw new Error('App-server returned a different thread ID');
    return id;
  }
  private async threadRequest(method: string, params: unknown): Promise<string> {
    const response = await this.request(method, params);
    const parsed = z.safeParse(z.looseObject({ thread: z.looseObject({ id: z.string().check(z.minLength(1)) }) }), response);
    if (!parsed.success) throw new Error(`Invalid ${method} response`);
    return parsed.data.thread.id;
  }
  async startTurn(threadId: string, text: string): Promise<string> {
    if (!threadId || !text) throw new Error('thread ID and prompt are required');
    const response = await this.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] });
    const parsed = z.safeParse(z.looseObject({ turn: z.looseObject({ id: z.string().check(z.minLength(1)) }) }), response);
    if (!parsed.success) throw new Error('Invalid turn/start response');
    return parsed.data.turn.id;
  }
  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    if (!threadId || !turnId) throw new Error('thread ID and turn ID are required');
    await this.request('turn/interrupt', { threadId, turnId });
  }
  close(): void {
    if (this.closing) return;
    this.closing = true; this.peer.close(); this.child.stdin.end(); this.child.kill();
  }
  private async read(): Promise<void> {
    const decoder = new RpcLineDecoder();
    try {
      for await (const chunk of this.child.stdout) {
        for (const frame of decoder.push(chunk)) void this.peer.receive(frame).catch(() => this.close());
      }
      if (!this.closing) decoder.finish();
    } catch { if (!this.closing) this.close(); }
  }
}
