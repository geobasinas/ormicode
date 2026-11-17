import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Frame } from '@ormicode/protocol';
import { parseRequestBody, newId } from '@ormicode/protocol';
import { openStore, createSession, getSession, listSessions, setState, setWorkerPid, setNativeId, type Store, type SessionState } from '@ormicode/session-store';
import { append, replay, checkTail } from '@ormicode/journal';
import { serve, defaultSocketPath, ormicodeDir, type Link } from './socket.ts';
import { hasTransport } from './registry.ts';

const WORKER_MAIN = join(dirname(fileURLToPath(import.meta.url)), 'worker-main.ts');
const startedAt = Date.now();

interface Worker { proc: ChildProcess; session: string; pid: number | undefined; ready: boolean }
interface Client { link: Link; subscriptions: Set<string>; device: string }

const stateFor: Record<string, SessionState> = {
  turn_start: 'running', turn_end: 'idle', approval_request: 'awaiting_approval',
  approval_decision: 'running', question_request: 'awaiting_input',
  rate_limited: 'retrying', retry_scheduled: 'retrying', interrupted: 'interrupted',
};

export interface DaemonOptions { socketPath?: string; storePath?: string }

export async function startDaemon(opts: DaemonOptions = {}) {
  let socketPath = opts.socketPath ?? process.env.ORMICODE_SOCKET ?? defaultSocketPath();
  const storePath = opts.storePath ?? process.env.ORMICODE_STORE ?? join(ormicodeDir(), 'store.db');
  const db = openStore(storePath);
  if (socketPath !== defaultSocketPath() && existsSync(socketPath)) rmSync(socketPath);

  const workers = new Map<string, Worker>();
  const clients = new Set<Client>();
  let lastError: string | null = null;
  let closing = false;

  // Boot: mark any previously-live sessions interrupted; no orphans are adopted.
  const inFlight = ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited'];
  for (const s of listSessions(db).filter(s => [...inFlight, 'interrupted'].includes(s.state))) {
    checkTail(db, s.id);
    if (inFlight.includes(s.state)) {
      append(db, s.id, { kind: 'interrupted', payload: { reason: 'host_restart' } });
      setState(db, s.id, 'interrupted', 'host_restart');
    }
    if (s.worker_pid) { try { process.kill(s.worker_pid, 0); process.kill(s.worker_pid); } catch { /* gone */ } setWorkerPid(db, s.id, null); }
  }

  const fanout = (session: string, frame: string) => {
    for (const c of clients) if (c.subscriptions.has(session) && !c.link.closed) c.link.send(JSON.parse(frame));
  };
  const delta = (session: string, kind: string, text: string) => {
    for (const c of clients) if (c.subscriptions.has(session) && !c.link.closed)
      c.link.send({ v: 1, type: 'evt', session, ts: Date.now(), body: { kind, text } });
  };

  const record = (session: string, kind: string, payload: Record<string, unknown>, ts?: number, origin?: string) => {
    const { frame } = append(db, session, { kind, payload: { kind, ...payload }, ...(ts ? { ts } : {}), ...(origin ? { origin } : {}) });
    fanout(session, frame);
    const mapped = stateFor[kind];
    if (mapped) setState(db, session, mapped, typeof payload.reason === 'string' ? payload.reason : undefined, ts);
    else if (kind === 'state' && typeof payload.state === 'string') setState(db, session, payload.state as SessionState, typeof payload.reason === 'string' ? payload.reason : undefined, ts);
  };

  const spawnWorker = (session: string) => {
    const row = getSession(db, session);
    if (!row) throw new Error(`unknown session ${session}`);
    const proc = spawn(process.execPath, [WORKER_MAIN], {
      env: {
        ...process.env,
        ORMICODE_SOCKET: socketPath, ORMICODE_SESSION: session,
        ORMICODE_VENDOR: row.vendor, ORMICODE_TRANSPORT: row.transport,
        ORMICODE_CWD: row.cwd, ...(row.native_id ? { ORMICODE_RESUME: row.native_id } : {}),
        ...(row.model ? { ORMICODE_MODEL: row.model } : {}),
        ...(row.agent_command ? { ORMICODE_AGENT_COMMAND: row.agent_command } : {}),
        ...(row.agent_args ? { ORMICODE_AGENT_ARGS_JSON: row.agent_args } : {}),
      },
      stdio: 'ignore', windowsHide: true,
    });
    const worker: Worker = { proc, session, pid: proc.pid, ready: false };
    workers.set(session, worker);
    setState(db, session, 'starting');
    proc.on('exit', code => {
      if (closing) return;
      workers.delete(session);
      setWorkerPid(db, session, null);
      const current = getSession(db, session);
      if (current && ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying'].includes(current.state)) {
        record(session, 'interrupted', { reason: code === 0 ? 'stream_ended' : 'worker_crash' });
      }
    });
    proc.on('error', e => { lastError = String(e); });
    return worker;
  };

  const onWorkerFrame = (link: Link, frame: Frame) => {
    if (frame.type !== 'req') return;
    const { id, method } = frame;
    const body = frame.body as Record<string, unknown>;
    const session = String(body.session ?? '');
    const answer = (b: Record<string, unknown>) => link.reply(id, b);
    switch (method) {
      case 'worker.ready': {
        const w = workers.get(session);
        if (w) { w.ready = true; w.pid = Number(body.pid) || w.pid; setWorkerPid(db, session, w.pid ?? null); setState(db, session, 'idle'); }
        answer({ ok: true });
        break;
      }
      case 'worker.event': {
        const kind = String(body.kind);
        if (kind === 'text_delta' || kind === 'thinking_delta') {
          delta(session, kind, String((body.payload as Record<string, unknown>)?.text ?? ''));
          return answer({ seq: 0 });
        }
        // A stream that ends while no turn is in flight is a clean stop, not a crash.
        if (kind === 'interrupted' && (body.payload as Record<string, unknown>)?.reason === 'stream_ended'
            && !['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying'].includes(getSession(db, session)?.state ?? '')) {
          return answer({ seq: 0 });
        }
        const { seq } = append(db, session, { kind, payload: { kind, ...(body.payload as Record<string, unknown>) }, ts: Number(body.ts) || Date.now() });
        const frameOut = JSON.stringify({ v: 1, type: 'evt', session, seq, ts: Number(body.ts) || Date.now(), body: { kind, ...(body.payload as Record<string, unknown>) } });
        fanout(session, frameOut);
        const mapped = stateFor[kind];
        if (mapped) setState(db, session, mapped, typeof (body.payload as Record<string, unknown>)?.reason === 'string' ? (body.payload as Record<string, unknown>).reason as string : undefined);
        answer({ seq });
        break;
      }
      case 'worker.state':
        setState(db, session, body.state as SessionState, body.reason as string | undefined);
        answer({ seq: 0 });
        break;
      case 'worker.native':
        setNativeId(db, session, String(body.nativeId));
        answer({ ok: true });
        break;
      case 'worker.health':
        answer({ ok: true });
        break;
      default:
        link.replyError(id, 'protocol.unknown_method', method);
    }
  };

  const toWorker = async (session: string, method: string, body: Record<string, unknown>) => {
    const w = workers.get(session);
    const link = workerLinks.get(session);
    if (!w || !link) return undefined;
    return link.request(method, { session, ...body }, 30_000);
  };
  const workerLinks = new Map<string, Link>();
  const sessionByLink = new Map<Link, string>();

  const ensureWorker = (session: string): Promise<void> => new Promise((resolve, reject) => {
    if (workers.get(session)?.ready) return resolve();
    if (!workers.has(session)) spawnWorker(session);
    const deadline = Date.now() + 30_000;
    const poll = () => {
      if (workers.get(session)?.ready) return resolve();
      if (!workers.has(session)) return reject(new Error('worker exited before ready'));
      if (Date.now() > deadline) return reject(new Error('worker.ready timeout'));
      setTimeout(poll, 25);
    };
    poll();
  });

  const onClientFrame = async (client: Client, frame: Frame) => {
    if (frame.type === 'ack') { /* device cursor tracking lands with devices */ return; }
    if (frame.type !== 'req') return;
    const { id, method } = frame;
    const parsed = parseRequestBody(method, frame.body);
    if (!parsed.success) return client.link.replyError(id, parsed.error, method);
    const body = parsed.data as Record<string, unknown>;
    try {
      switch (method) {
        case 'daemon.status':
          return client.link.reply(id, { version: '0.0.0', uptimeMs: Date.now() - startedAt, liveWorkers: workers.size, relay: 'disconnected', lastError });
        case 'session.start': {
          const vendor = String(body.vendor); const transport = String(body.transport);
          if (!hasTransport(vendor, transport)) return client.link.replyError(id, 'agent.unsupported', `${vendor}/${transport}`);
          const sessionId = newId('s');
          createSession(db, {
            id: sessionId, machine: String(body.machine ?? 'm_local'), project: String(body.project),
            vendor, transport, cwd: process.cwd(),
            ...(body.model ? { model: String(body.model) } : {}),
            ...(body.effort ? { effort: String(body.effort) } : {}),
            ...(body.mode ? { mode: String(body.mode) } : {}),
            ...(body.agentCommand ? { agentCommand: String(body.agentCommand) } : {}),
            ...(body.agentArgs ? { agentArgs: body.agentArgs as string[] } : {}),
          });
          spawnWorker(sessionId);
          return client.link.reply(id, { session: sessionId });
        }
        case 'session.list': {
          const sessions = listSessions(db, Boolean(body.archived)).map(s => ({
            id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
            transport: s.transport, updatedAt: s.updated_at,
          }));
          return client.link.reply(id, { sessions });
        }
        case 'session.get': {
          const s = getSession(db, String(body.session));
          if (!s) return client.link.replyError(id, 'session.not_found', String(body.session));
          return client.link.reply(id, {
            id: s.id, title: s.title, state: s.state, project: s.project, vendor: s.vendor,
            transport: s.transport, updatedAt: s.updated_at, model: s.model, effort: s.effort,
            nativeId: s.native_id, acpVersion: s.acp_version,
          });
        }
        case 'session.prompt': {
          const session = String(body.session);
          const s = getSession(db, session);
          if (!s) return client.link.replyError(id, 'session.not_found', session);
          if (s.state === 'running') return client.link.replyError(id, 'session.busy', 'turn in progress');
          await ensureWorker(session);
          const res = await toWorker(session, 'worker.prompt', { text: body.text, ...(body.images ? { images: body.images } : {}) });
          if (!res || res.type === 'err') return client.link.replyError(id, 'agent.failed', 'worker rejected prompt');
          return client.link.reply(id, { accepted: true });
        }
        case 'session.steer': {
          const res = await toWorker(String(body.session), 'worker.steer', { text: body.text });
          return res?.type === 'res' ? client.link.reply(id, { accepted: true, queued: false }) : client.link.replyError(id, 'agent.unsupported', 'steer');
        }
        case 'session.abort': {
          const res = await toWorker(String(body.session), 'worker.abort', {});
          return res?.type === 'res' ? client.link.reply(id, { interrupted: true }) : client.link.replyError(id, 'agent.unsupported', 'abort');
        }
        case 'session.decide': {
          const res = await toWorker(String(body.session), 'worker.decide', { request: body.request, option: body.option });
          return res?.type === 'res' ? client.link.reply(id, { decided: true }) : client.link.replyError(id, 'agent.unsupported', 'decide');
        }
        case 'session.subscribe': {
          const session = String(body.session);
          client.subscriptions.add(session);
          for (const row of replay(db, session, Number(body.after ?? 0))) {
            client.link.send(JSON.parse(JSON.stringify({ v: 1, type: 'evt', session, seq: row.seq, ts: row.ts, body: JSON.parse(row.payload) })));
          }
          return client.link.reply(id, { subscribed: true });
        }
        case 'session.unsubscribe':
          client.subscriptions.delete(String(body.session));
          return client.link.reply(id, { unsubscribed: true });
        case 'session.archive': {
          const { archiveSession } = await import('@ormicode/session-store');
          archiveSession(db, String(body.session));
          return client.link.reply(id, { archived: true });
        }
        default:
          return client.link.replyError(id, 'protocol.unimplemented', method);
      }
    } catch (error) {
      return client.link.replyError(id, 'daemon.error', error instanceof Error ? error.message : String(error));
    }
  };

  const server = await serve(socketPath, link => {
    link.onFrame = frame => {
      if (frame.type === 'req' && typeof frame.method === 'string' && frame.method.startsWith('worker.')) {
        const session = String((frame.body as Record<string, unknown>).session ?? '');
        if (frame.method === 'worker.ready') { workerLinks.set(session, link); sessionByLink.set(link, session); }
        onWorkerFrame(link, frame);
      } else {
        let client = [...clients].find(c => c.link === link);
        if (!client) { client = { link, subscriptions: new Set(), device: 'cli' }; clients.add(client); }
        void onClientFrame(client, frame);
      }
    };
    link.onClose = () => {
      for (const c of clients) if (c.link === link) clients.delete(c);
      const s = sessionByLink.get(link);
      if (s) { workerLinks.delete(s); sessionByLink.delete(link); }
    };
  });

  const addr = server.address();
  if (typeof addr === 'object' && addr) socketPath = `127.0.0.1:${addr.port}`;
  return {
    socketPath, storePath, db, workers,
    async close() {
      closing = true;
      for (const w of workers.values()) {
        const link = workerLinks.get(w.session);
        try { await link?.request('worker.evict', { session: w.session }, 5_000); } catch { /* kill below */ }
        try { w.proc.kill(); } catch { /* already dead */ }
      }
      for (const c of clients) c.link.close();
      for (const link of workerLinks.values()) link.close();
      server.close();
      db.close();
    },
  };
}
