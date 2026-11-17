import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Frame } from '@ormicode/protocol';
import { openStore, getSession, setState, setWorkerPid, setNativeId, type SessionState } from '@ormicode/session-store';
import { killTree } from './proctree.ts';
import { recoverSessions, resumePolicy } from './recovery.ts';
import { handoffBrief } from './handoff.ts';
import { onClientFrame, type Client, type DispatchCtx } from './dispatch.ts';
import { append } from '@ormicode/journal';
import { serve, defaultSocketPath, ormicodeDir, type Link } from './socket.ts';

const WORKER_MAIN = join(dirname(fileURLToPath(import.meta.url)), 'worker-main.ts');
const startedAt = Date.now();

interface Worker { proc: ChildProcess; session: string; pid: number | undefined; ready: boolean }

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
  const notesDir = join(ormicodeDir(), 'notes');
  const paused = new Set<string>();
  const heldPrompts = new Map<string, { text: string; images?: unknown[] }[]>();
  const lastPrompt = new Map<string, { text: string; images?: unknown[] }>();
  const idleTimers = new Map<string, NodeJS.Timeout>();
  const idleTimeoutMs = Number(process.env.ORMICODE_IDLE_TIMEOUT_MS ?? 20 * 60_000);
  const poolMax = Number(process.env.ORMICODE_POOL_MAX ?? 8);
  // Boot: interrupt in-flight sessions, expire pending interactions, reap stale
  // pids; auto-resume candidates are spawned once spawnWorker exists below.
  const resuming = new Set<string>();
  const recovery = recoverSessions(db, resumePolicy());

  const fanout = (session: string, frame: string) => {
    for (const c of clients) if (c.subscriptions.has(session) && !c.link.closed) c.link.send(JSON.parse(frame));
  };
  const delta = (session: string, kind: string, text: string) => {
    for (const c of clients) if (c.subscriptions.has(session) && !c.link.closed)
      c.link.send({ v: 1, type: 'evt', session, ts: Date.now(), body: { kind, text } });
  };

  const record = (session: string, kind: string, payload: Record<string, unknown>, ts?: number, origin?: string) => {
    if (closing) return;
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
      stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32',
    });
    const worker: Worker = { proc, session, pid: proc.pid, ready: false };
    workers.set(session, worker);
    setState(db, session, 'starting');
    proc.on('exit', code => {
      if (closing) return;
      const wasResuming = resuming.delete(session);
      const retryTimer = retryTimers.get(session);
      if (retryTimer) { clearTimeout(retryTimer); retryTimers.delete(session); }
      workers.delete(session);
      setWorkerPid(db, session, null);
      const current = getSession(db, session);
      if (current && ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying'].includes(current.state)) {
        record(session, 'interrupted', { reason: code === 0 ? 'stream_ended' : 'worker_crash' });
      }
      // A resume candidate whose worker died before ready leaves a recap so the
      // session is continuable by handoff even though the native load failed.
      if (wasResuming && getSession(db, session)?.state === 'interrupted') {
        record(session, 'handoff_brief', { text: handoffBrief(db, session) });
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
        if (w) {
          w.ready = true; w.pid = Number(body.pid) || w.pid; setWorkerPid(db, session, w.pid ?? null); setState(db, session, 'idle'); armIdle(session, 'idle'); enforcePool();
          if (resuming.delete(session)) record(session, 'resumed', {});
        }
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
        const payload = body.payload as Record<string, unknown>;
        const mapped = stateFor[kind];
        if (mapped) {
          setState(db, session, mapped, typeof payload?.reason === 'string' ? payload.reason as string : undefined);
          armIdle(session, mapped);
        }
        if (kind === 'error' && typeof payload?.resetAt === 'number'
            && (payload.code === 'rate_limited' || payload.code === 'plan_limit')) {
          setState(db, session, 'paused_rate_limited', String(payload.code));
          scheduleRateRetry(session, payload.resetAt);
        }
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

  const evictWorker = async (session: string, reason: string) => {
    if (closing) return;
    const w = workers.get(session);
    const link = workerLinks.get(session);
    if (link) { try { await link.request('worker.evict', { session }, 10_000); } catch { if (w) killTree(w.proc); } }
    else if (w) killTree(w.proc);
    workers.delete(session);
    record(session, 'evicted', { reason, idleMs: 0 });
    setState(db, session, 'idle', reason);
  };

  const armIdle = (session: string, state: SessionState) => {
    const existing = idleTimers.get(session);
    if (existing) { clearTimeout(existing); idleTimers.delete(session); }
    if (state === 'idle' || state === 'done') {
      idleTimers.set(session, setTimeout(() => { void evictWorker(session, 'idle_timeout'); }, idleTimeoutMs).unref());
    }
  };

  const enforcePool = () => {
    const live = [...workers.entries()].filter(([, w]) => w.ready);
    if (live.length <= poolMax) return;
    const idle = live.filter(([s]) => getSession(db, s)?.state === 'idle' && !(getSession(db, s)?.pinned));
    if (idle.length) void evictWorker(idle[0]![0], 'pool_full');
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

  const sendPrompt = async (session: string, text: string, images?: unknown[]): Promise<boolean> => {
    await ensureWorker(session);
    const res = await toWorker(session, 'worker.prompt', { text, ...(images ? { images } : {}) });
    if (!res || res.type === 'err') return false;
    lastPrompt.set(session, { text, ...(images ? { images } : {}) });
    return true;
  };

  // Sessions paused by a rate limit wake at the provider's reset time and retry
  // the held prompt; timers are in-memory and re-armed from the journal on boot.
  const retryTimers = new Map<string, NodeJS.Timeout>();
  const scheduleRateRetry = (session: string, resetAt: number) => {
    const existing = retryTimers.get(session);
    if (existing) clearTimeout(existing);
    retryTimers.set(session, setTimeout(() => {
      retryTimers.delete(session);
      const last = lastPrompt.get(session);
      if (last && getSession(db, session)?.state === 'paused_rate_limited') {
        void sendPrompt(session, last.text, last.images).then(ok => { if (!ok) setState(db, session, 'interrupted', 'resume_failed'); });
      }
    }, Math.max(0, resetAt - Date.now())).unref());
  };

  const dispatchCtx: DispatchCtx = {
    db, notesDir, startedAt, paused, heldPrompts, lastPrompt,
    lastError: () => lastError, liveWorkers: () => workers.size,
    spawnWorker, toWorker, sendPrompt,
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
        void onClientFrame(dispatchCtx, client, frame);
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
  // Resume spawns only after the socket is bound — workers connect on start.
  for (const s of recovery.autoResume) { resuming.add(s.id); spawnWorker(s.id); }
  for (const r of recovery.rateLimited) scheduleRateRetry(r.id, r.resetAt);
  return {
    socketPath, storePath, db, workers,
    async close() {
      closing = true;
      for (const t of idleTimers.values()) clearTimeout(t);
      idleTimers.clear();
      for (const t of retryTimers.values()) clearTimeout(t);
      retryTimers.clear();
      for (const w of workers.values()) {
        const link = workerLinks.get(w.session);
        try { await link?.request('worker.evict', { session: w.session }, 5_000); } catch { /* kill below */ }
        try { killTree(w.proc); } catch { /* already dead */ }
      }
      for (const c of clients) c.link.close();
      for (const link of workerLinks.values()) link.close();
      server.close();
      db.close();
    },
  };
}
