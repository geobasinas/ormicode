import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import type { OpenCodeClient } from '@opencode/client';
import * as z from 'zod/mini';
import type { ModelList } from '@ormicode/agent-core';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** Owns a private OpenCode v2 HTTP server and its authenticated SDK client. */
export class OpenCodeServer {
  readonly client: OpenCodeClient;
  private readonly child: ChildProcessWithoutNullStreams;
  private closed = false;
  private constructor(child: ChildProcessWithoutNullStreams, client: OpenCodeClient) { this.child = child; this.client = client; }
  static async start(options: { executable?: string; cwd?: string; spawn?: Spawn; timeoutMs?: number } = {}): Promise<OpenCodeServer> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid server startup timeout');
    const password = randomBytes(32).toString('base64url');
    const child = (options.spawn ?? spawn)(options.executable ?? 'opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: options.cwd, env: { ...process.env, OPENCODE_SERVER_PASSWORD: password }, windowsHide: true, shell: false });
    child.stderr.resume(); child.stdin.end();
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let buffer = ''; let finished = false;
        const timer = setTimeout(() => finish(new Error('OpenCode server startup timed out')), timeoutMs);
        const finish = (error?: Error, value?: string) => {
          if (finished) return; finished = true; clearTimeout(timer);
          child.stdout.off('data', onData); child.off('error', onError); child.off('close', onClose);
          if (error) reject(error); else resolve(value!);
        };
        const onError = () => finish(new Error('OpenCode server failed to start'));
        const onClose = () => finish(new Error('OpenCode server exited before startup'));
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          if (buffer.length > 8192) return finish(new Error('Unexpected OpenCode startup output'));
          const match = /(?:^|\n)server listening on (http:\/\/127\.0\.0\.1:\d+)\s*(?:\r?\n|$)/.exec(buffer);
          if (match) finish(undefined, match[1]);
        };
        child.stdout.on('data', onData); child.once('error', onError); child.once('close', onClose);
      });
      const auth = Buffer.from(`opencode:${password}`).toString('base64');
      const client = OpenCode.make({ baseUrl: url, headers: { authorization: `Basic ${auth}` } });
      const server = new OpenCodeServer(child, client);
      child.stdout.resume(); child.on('error', () => { server.closed = true; }); child.once('close', () => { server.closed = true; });
      const info = await client.server.info({ signal: AbortSignal.timeout(timeoutMs) });
      if (info?.version !== '2.2.5') throw new Error('Unsupported OpenCode server version; expected 2.2.5');
      return server;
    } catch (error) { child.kill(); throw error; }
  }
  async createSession(cwd: string): Promise<string> {
    if (this.closed) throw new Error('OpenCode server is closed');
    if (!cwd) throw new Error('cwd is required');
    const session = await this.client.session.create({ location: { directory: cwd } });
    const parsed = z.safeParse(z.looseObject({ id: z.string().check(z.minLength(1)) }), session);
    if (!parsed.success) throw new Error('OpenCode returned no session ID');
    return parsed.data.id;
  }
  async getSession(sessionId: string): Promise<{ id: string }> {
    if (this.closed || !sessionId) throw new Error('OpenCode server closed or session ID missing');
    const session = await this.client.session.get({ sessionID: sessionId });
    const parsed = z.safeParse(z.looseObject({ id: z.string().check(z.minLength(1)) }), session);
    if (!parsed.success || parsed.data.id !== sessionId) throw new Error('OpenCode returned a different or invalid session ID');
    return parsed.data;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.child.kill();
  }
}

const modelRef = z.looseObject({ id: z.string().check(z.minLength(1)), modelID: z.optional(z.string()), providerID: z.string().check(z.minLength(1)), name: z.optional(z.string()), variants: z.optional(z.array(z.looseObject({ id: z.string() }))) });

/** Catalog from model/list: ids, display names and variant ids (the effort pickers). */
export async function listOpenCodeModels(server: OpenCodeServer): Promise<ModelList> {
  const listed = await server.client.model.list();
  const data = z.safeParse(z.looseObject({ data: z.array(modelRef) }), listed);
  if (!data.success) return [];
  return data.data.data.map(model => ({ id: `${model.providerID}/${model.modelID ?? model.id}`, ...(model.name !== undefined ? { name: model.name } : {}), ...(model.variants?.length ? { efforts: model.variants.map(variant => variant.id) } : {}) }));
}
