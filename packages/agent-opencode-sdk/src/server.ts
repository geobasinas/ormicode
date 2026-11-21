import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import type { OpenCodeClient } from '@opencode/client';
import * as z from 'zod/mini';
import type { ModelList, SessionMode } from '@ormicode/agent-core';

type Spawn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

/** `@opencode-ai/sdk` `createOpencode({ timeout })` defaults to 5s, which is too short for a cold `opencode serve`. */
export const OPENCODE_SERVER_START_TIMEOUT_MS = 60_000;
const LISTEN = /(?:^|\n)(?:opencode )?server listening on (http:\/\/127\.0\.0\.1:\d+)\s*(?:\r?\n|$)/;
const PINNED_INFO_VERSION = '2.2.5';

async function serverHealthy(url: string, authorization: string, signal: AbortSignal): Promise<boolean> {
  for (const path of ['/api/health', '/global/health']) {
    try {
      const response = await fetch(new URL(path, url), { headers: { authorization, accept: 'application/json' }, signal });
      if (!response.ok) continue;
      const body = await response.json() as { healthy?: unknown };
      if (body?.healthy === true) return true;
    } catch { /* Probe the other health route, then the startup deadline. */ }
  }
  return false;
}

/** Owns a private OpenCode HTTP server and its authenticated SDK client. */
export class OpenCodeServer {
  readonly client: OpenCodeClient;
  private readonly child: ChildProcessWithoutNullStreams;
  private closed = false;
  private constructor(child: ChildProcessWithoutNullStreams, client: OpenCodeClient) { this.child = child; this.client = client; }
  static async start(options: { executable?: string; cwd?: string; spawn?: Spawn; timeoutMs?: number } = {}): Promise<OpenCodeServer> {
    const timeoutMs = options.timeoutMs ?? OPENCODE_SERVER_START_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid server startup timeout');
    const password = randomBytes(32).toString('base64url');
    const child = (options.spawn ?? spawn)(options.executable ?? 'opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: options.cwd, env: { ...process.env, OPENCODE_SERVER_PASSWORD: password }, windowsHide: true, shell: false });
    child.stderr.resume(); child.stdin.end();
    const deadline = Date.now() + timeoutMs;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let buffer = ''; let finished = false;
        const timer = setTimeout(() => finish(new Error('OpenCode server startup timed out')), Math.max(1, deadline - Date.now()));
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
          const match = LISTEN.exec(buffer);
          if (match?.[1]) finish(undefined, match[1]);
        };
        child.stdout.on('data', onData); child.once('error', onError); child.once('close', onClose);
      });
      const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
      const client = OpenCode.make({ baseUrl: url, headers: { authorization } });
      const server = new OpenCodeServer(child, client);
      child.stdout.resume(); child.on('error', () => { server.closed = true; }); child.once('close', () => { server.closed = true; });
      const remaining = () => Math.max(1, deadline - Date.now());
      let info: { version?: string } | undefined;
      try { info = await client.server.info({ signal: AbortSignal.timeout(Math.min(10_000, remaining())) }); }
      catch { info = undefined; }
      if (info?.version === PINNED_INFO_VERSION) return server;
      if (typeof info?.version === 'string') throw new Error('Unsupported OpenCode server version; expected 2.2.5');
      while (Date.now() < deadline) {
        if (await serverHealthy(url, authorization, AbortSignal.timeout(Math.min(5_000, remaining())))) return server;
        await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining())));
      }
      throw new Error('OpenCode server startup timed out');
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

const agentRef = z.looseObject({ id: z.string().check(z.minLength(1)), name: z.optional(z.string()), description: z.optional(z.string()), mode: z.optional(z.string()), hidden: z.optional(z.boolean()) });

/** Agents a session can switch to (primary/all, not hidden) — each carries the vendor's own permission ruleset. */
export async function listOpenCodeAgents(server: OpenCodeServer, cwd?: string): Promise<SessionMode[]> {
  const listed = await server.client.agent.list(cwd ? { location: { directory: cwd } } : {});
  const data = z.safeParse(z.looseObject({ data: z.array(agentRef) }), listed);
  if (!data.success) return [];
  const agents: SessionMode[] = data.data.data.flatMap(agent =>
    (agent.mode === undefined || agent.mode === 'primary' || agent.mode === 'all') && agent.hidden !== true
      ? [{ id: agent.id, name: agent.name ?? agent.id, ...(agent.description ? { description: agent.description } : {}) }] : []);
  // OpenCode falls back to `build`, then the first visible primary agent (https://opencode.ai/docs/agents/#selection).
  const fallback = agents.find(agent => agent.id === 'build') ?? agents[0];
  return agents.map(agent => agent === fallback ? { ...agent, default: true } : agent);
}
