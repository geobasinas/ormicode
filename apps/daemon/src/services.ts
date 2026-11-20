import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { getSession, type Store } from '@ormicode/session-store';
import { killTreePid } from './proctree.ts';
import { allocateSessionPorts } from './session-ports.ts';
import { environmentForSession } from './session-env.ts';
import { PreviewProxy } from './preview-proxy.ts';
import { PreviewFetchPages } from './preview-fetch.ts';
import type { PreviewConsoleEntry } from './preview-inspector.ts';

const serviceSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  health: z.string().startsWith('/').optional(),
  health_timeout: z.number().positive().max(3600).optional(),
  port: z.number().int().min(0).max(9).optional(),
  env: z.record(z.string(), z.string()).optional(),
  portals: z.array(z.object({ url: z.string().startsWith('/'), title: z.string().min(1) })).optional(),
});
const servicesSchema = z.object({ services: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), serviceSchema) });
type ServiceConfig = z.infer<typeof serviceSchema>;
type State = 'stopped' | 'starting' | 'running' | 'unhealthy' | 'exited';
interface Definition { name: string; config: ServiceConfig; offset: number; cwd: string }
interface ConfigResult { found: boolean; path?: string; error?: string; definitions: Definition[] }
interface LogLine { id: number; text: string; stream: 'stdout' | 'stderr' }
interface Runtime extends Definition {
  port: number;
  state: State; child?: ChildProcess; pid?: number; code?: number | null; detail?: string;
  startedAt?: number; stopping: boolean; lines: LogLine[]; bytes: number; nextLine: number;
  partial: Map<string, string>;
}
interface Portal { title: string; path: string; url: string }
interface ServiceView {
  name: string; state: State; port: number; pid?: number; code?: number | null; detail?: string;
  startedAt?: number; health?: string; portals: Portal[];
}

export class ServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function probeTcp(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolveResult => {
    const socket = createConnection(port, '127.0.0.1');
    const done = (value: boolean) => { socket.destroy(); resolveResult(value); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function probeHttp(port: number, path: string): Promise<boolean> {
  return new Promise(resolveResult => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET' }, res => {
      res.resume();
      resolveResult((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 400);
    });
    req.setTimeout(450, () => { req.destroy(); resolveResult(false); });
    req.once('error', () => resolveResult(false));
    req.end();
  });
}

export class Services {
  private readonly sessions = new Map<string, Map<string, Runtime>>();
  private readonly db: Store;
  private readonly proxy: PreviewProxy;
  private readonly fetchPages = new PreviewFetchPages();
  private readonly record: (session: string, kind: string, payload: Record<string, unknown>) => void;
  private readonly home: string;
  constructor(
    db: Store, proxy: PreviewProxy,
    record: (session: string, kind: string, payload: Record<string, unknown>) => void,
    home: string,
  ) {
    this.db = db; this.proxy = proxy; this.record = record; this.home = home;
  }

  private config(cwd: string, project: string): ConfigResult {
    const roots = [...new Set([cwd, project === 'scratch' ? cwd : project])];
    const path = roots.map(root => join(root, '.ormi', 'services.yaml')).find(candidate => existsSync(candidate));
    if (!path) return { found: false, definitions: [] };
    try {
      const parsed = servicesSchema.safeParse(parseYaml(readFileSync(path, 'utf8')));
      if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
      const entries = Object.entries(parsed.data.services);
      if (entries.length > 10) throw new Error('services.yaml may declare at most 10 services');
      const seen = new Set<number>();
      const root = realpathSync(cwd);
      const definitions = entries.map(([name, config], index) => {
        const offset = config.port ?? index;
        if (seen.has(offset)) throw new Error(`duplicate service port offset ${offset}`);
        seen.add(offset);
        const candidate = resolve(cwd, config.cwd ?? '.');
        if (isAbsolute(config.cwd ?? '') || !within(resolve(cwd), candidate)) throw new Error(`${name}.cwd must stay inside the session folder`);
        const realCwd = realpathSync(candidate);
        if (!within(root, realCwd)) throw new Error(`${name}.cwd resolves outside the session folder`);
        return { name, config, offset, cwd: realCwd };
      });
      return { found: true, path, definitions };
    } catch (error) {
      return { found: true, path, error: error instanceof Error ? error.message : String(error), definitions: [] };
    }
  }

  private runtimes(session: string): Map<string, Runtime> {
    let runtimes = this.sessions.get(session);
    if (!runtimes) { runtimes = new Map(); this.sessions.set(session, runtimes); }
    return runtimes;
  }

  private runtime(session: string, definition: Definition, base: number): Runtime {
    const runtimes = this.runtimes(session);
    let runtime = runtimes.get(definition.name);
    if (!runtime) {
      runtime = {
        ...definition, port: base + definition.offset, state: 'stopped', stopping: false,
        lines: [], bytes: 0, nextLine: 1, partial: new Map(),
      };
      runtimes.set(definition.name, runtime);
    } else Object.assign(runtime, definition, { port: base + definition.offset });
    return runtime;
  }

  private transition(session: string, runtime: Runtime, state: State, detail?: string, code?: number | null): void {
    if (runtime.state === state && runtime.detail === detail && runtime.code === code) return;
    runtime.state = state; runtime.detail = detail; runtime.code = code;
    this.record(session, 'service_state', {
      service: runtime.name, state, port: runtime.port,
      ...(code === undefined ? {} : { code }), ...(detail ? { detail } : {}),
    });
  }

  private view(session: string, runtime: Runtime, base: number): ServiceView {
    const portals = runtime.config.portals ?? [{ url: '/', title: runtime.name }];
    return {
      name: runtime.name, state: runtime.state, port: runtime.port,
      ...(runtime.pid === undefined ? {} : { pid: runtime.pid }),
      ...(runtime.code === undefined ? {} : { code: runtime.code }),
      ...(runtime.detail ? { detail: runtime.detail } : {}),
      ...(runtime.startedAt === undefined ? {} : { startedAt: runtime.startedAt }),
      ...(runtime.config.health ? { health: runtime.config.health } : {}),
      portals: portals.map(portal => ({
        title: portal.title, path: portal.url,
        url: this.proxy.url(session, base, runtime.port, portal.url),
      })),
    };
  }

  async list(session: string): Promise<Record<string, unknown>> {
    const row = getSession(this.db, session);
    if (!row) throw new ServiceError('session.not_found', session);
    const ports = await allocateSessionPorts(this.db, session);
    const config = this.config(row.cwd, row.project);
    const runtimes = config.error ? [] : config.definitions.map(definition => this.runtime(session, definition, ports.base));
    for (const runtime of runtimes) this.proxy.register(session, ports.base, runtime.port);
    const active = new Set(runtimes.filter(runtime => runtime.child && runtime.child.exitCode === null).map(runtime => runtime.port));
    const detected: { port: number; url: string }[] = [];
    for (let port = ports.base; port < ports.base + ports.count; port++) {
      if (active.has(port) || !await probeTcp(port, 150)) continue;
      this.proxy.register(session, ports.base, port, true);
      detected.push({ port, url: this.proxy.url(session, ports.base, port) });
    }
    return {
      ports, proxy: { port: this.proxy.port },
      config: { found: config.found, ...(config.path ? { path: config.path } : {}), ...(config.error ? { error: config.error } : {}) },
      services: runtimes.map(runtime => this.view(session, runtime, ports.base)), detected,
    };
  }

  previewConsole(session: string, after?: number, limit?: number) {
    if (!getSession(this.db, session)) throw new ServiceError('session.not_found', session);
    return this.proxy.console(session, after, limit);
  }

  clearPreviewConsole(session: string): void {
    if (!getSession(this.db, session)) throw new ServiceError('session.not_found', session);
    this.proxy.clearConsole(session);
  }

  previewEntries(session: string, ids: string[]): PreviewConsoleEntry[] {
    return this.proxy.consoleEntries(session, ids);
  }

  async previewFetch(client: string, session: string, port: number, method: string, path: string,
    headers: Record<string, string>, body: Buffer) {
    if (!getSession(this.db, session)) throw new ServiceError('session.not_found', session);
    try { return this.fetchPages.first(client, await this.proxy.fetch(session, port, method, path, headers, body)); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
        throw new ServiceError(error.code, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  previewFetchMore(client: string, handle: string) {
    try { return this.fetchPages.next(client, handle); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
        throw new ServiceError(error.code, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async start(session: string, name: string): Promise<ServiceView> {
    const row = getSession(this.db, session);
    if (!row) throw new ServiceError('session.not_found', session);
    const ports = await allocateSessionPorts(this.db, session);
    const config = this.config(row.cwd, row.project);
    if (config.error) throw new ServiceError('config.error', config.error);
    const definition = config.definitions.find(entry => entry.name === name);
    if (!definition) throw new ServiceError('service.not_found', name);
    const runtime = this.runtime(session, definition, ports.base);
    if (runtime.child && runtime.child.exitCode === null) return this.view(session, runtime, ports.base);
    this.proxy.rotate(session, ports.base, runtime.port);
    runtime.pid = undefined; runtime.code = undefined; runtime.detail = undefined;
    runtime.startedAt = Date.now(); runtime.stopping = false;
    this.transition(session, runtime, 'starting');
    const env = {
      ...process.env, ...environmentForSession(row, ports.base),
      PORT: String(runtime.port), PUBLIC_URL: this.proxy.origin(session, runtime.port),
      ...definition.config.env,
    };
    const batch = process.platform === 'win32';
    let child: ChildProcess;
    try {
      child = spawn(batch ? 'cmd' : 'bash', batch ? ['/c', definition.config.command] : ['-c', definition.config.command], {
        cwd: definition.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch (error) {
      this.transition(session, runtime, 'exited', String(error));
      throw new ServiceError('service.start_failed', String(error));
    }
    runtime.child = child; runtime.pid = child.pid;
    child.stdout?.on('data', chunk => this.consume(session, runtime, 'stdout', chunk.toString()));
    child.stderr?.on('data', chunk => this.consume(session, runtime, 'stderr', chunk.toString()));
    child.once('error', error => this.transition(session, runtime, 'exited', error.message));
    child.once('close', code => {
      for (const stream of ['stdout', 'stderr'] as const) {
        const remaining = runtime.partial.get(stream) ?? '';
        if (remaining) this.pushLine(session, runtime, remaining, stream);
        runtime.partial.set(stream, '');
      }
      runtime.child = undefined;
      runtime.pid = undefined;
      if (runtime.stopping) this.transition(session, runtime, 'stopped');
      else this.transition(session, runtime, 'exited', undefined, code);
    });
    void this.monitor(session, runtime, child);
    return this.view(session, runtime, ports.base);
  }

  private async monitor(session: string, runtime: Runtime, child: ChildProcess): Promise<void> {
    const timeout = (runtime.config.health_timeout ?? 60) * 1000;
    const deadline = Date.now() + timeout;
    while (runtime.child === child && child.exitCode === null) {
      const healthy = runtime.config.health
        ? await probeHttp(runtime.port, runtime.config.health)
        : await probeTcp(runtime.port, 500);
      if (healthy && runtime.child === child) { this.transition(session, runtime, 'running'); return; }
      if (Date.now() >= deadline) { this.transition(session, runtime, 'unhealthy', `health check timed out after ${runtime.config.health_timeout ?? 60}s`); return; }
      await sleep(500);
    }
  }

  private consume(session: string, runtime: Runtime, stream: 'stdout' | 'stderr', chunk: string): void {
    const text = `${runtime.partial.get(stream) ?? ''}${chunk}`;
    const parts = text.split(/\r?\n/);
    runtime.partial.set(stream, parts.pop() ?? '');
    for (const line of parts) this.pushLine(session, runtime, line, stream);
  }

  private pushLine(session: string, runtime: Runtime, text: string, stream: 'stdout' | 'stderr'): void {
    const line = text.slice(-1024 * 1024);
    const entry = { id: runtime.nextLine++, text: line, stream };
    runtime.lines.push(entry); runtime.bytes += Buffer.byteLength(`${line}\n`);
    const path = join(this.home, 'logs', 'services', session, `${runtime.name}.log`);
    mkdirSync(join(this.home, 'logs', 'services', session), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
    while (runtime.lines.length > 2000 || runtime.bytes > 1024 * 1024) {
      const removed = runtime.lines.shift();
      if (removed) runtime.bytes -= Buffer.byteLength(`${removed.text}\n`);
    }
  }

  async stop(session: string, name: string): Promise<ServiceView> {
    const row = getSession(this.db, session);
    if (!row) throw new ServiceError('session.not_found', session);
    const ports = await allocateSessionPorts(this.db, session);
    let runtime = this.runtimes(session).get(name);
    if (!runtime) {
      const config = this.config(row.cwd, row.project);
      if (config.error) throw new ServiceError('config.error', config.error);
      const definition = config.definitions.find(entry => entry.name === name);
      if (definition) runtime = this.runtime(session, definition, ports.base);
    }
    if (!runtime) throw new ServiceError('service.not_found', name);
    const child = runtime.child;
    if (child?.pid && child.exitCode === null) {
      runtime.stopping = true;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch { /* already stopped */ }
      await new Promise<void>(resolveWait => {
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.pid) {
            killTreePid(child.pid);
            runtime.child = undefined;
            runtime.pid = undefined;
            this.transition(session, runtime, 'stopped');
          }
          resolveWait();
        }, 5000);
        child.once('close', () => { clearTimeout(timer); resolveWait(); });
      });
    } else this.transition(session, runtime, 'stopped');
    return this.view(session, runtime, ports.base);
  }

  async restart(session: string, name: string): Promise<ServiceView> {
    await this.stop(session, name);
    return this.start(session, name);
  }

  logs(session: string, name: string, after?: number): { lines: { text: string; stream: 'stdout' | 'stderr' }[]; next: number; truncated: boolean } {
    const runtime = this.runtimes(session).get(name);
    if (!runtime) throw new ServiceError('service.not_found', name);
    const cursor = after ?? 0;
    const oldest = runtime.lines[0]?.id ?? runtime.nextLine;
    const truncated = cursor < oldest - 1;
    const lines = runtime.lines.filter(line => line.id > cursor).map(({ text, stream }) => ({ text, stream }));
    return { lines, next: runtime.lines.at(-1)?.id ?? cursor, truncated };
  }

  async previewUrl(session: string, port: number, path = '/'): Promise<string> {
    const row = getSession(this.db, session);
    if (!row) throw new ServiceError('session.not_found', session);
    const ports = await allocateSessionPorts(this.db, session);
    if (!Number.isInteger(port) || port < ports.base || port >= ports.base + ports.count)
      throw new ServiceError('preview.port_denied', `port ${port} is outside this session's port block`);
    return this.proxy.url(session, ports.base, port, path);
  }

  async stopSession(session: string): Promise<void> {
    const services = [...(this.sessions.get(session)?.keys() ?? [])];
    await Promise.all(services.map(name => this.stop(session, name).catch(() => undefined)));
  }

  async shutdown(): Promise<void> {
    this.fetchPages.close();
    await Promise.all([...this.sessions.keys()].map(session => this.stopSession(session)));
  }
}
