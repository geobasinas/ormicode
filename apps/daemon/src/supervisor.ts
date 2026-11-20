import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Frame, PromptAttachment, PromptContext } from '@ormicode/protocol';
import {
  openStore, getSession, getSessionPorts, setState, setWorkerPid, setNativeId, listSessions,
  type SessionState,
} from '@ormicode/session-store';
import { killTree } from './proctree.ts';
import { recoverSessions, resumePolicy, sweepLogs } from './recovery.ts';
import { handoffBrief } from './handoff.ts';
import { expireHandoffApprovals } from './handoff-dispatch.ts';
import { onClientFrame, type Client, type DispatchCtx } from './dispatch.ts';
import { Pairing, loadHubConfig, handleJoin } from './pair.ts';
import { RelayClient, RemoteLink } from './relay.ts';
import { append } from '@ormicode/journal';
import { createPromptDelivery } from './prompt-delivery.ts';
import { Checkpoints, DEFAULT_LIMITS } from '@ormicode/checkpoints';
import { SecretBroker } from './secrets.ts';
import { TerminalHub } from './terminal-methods.ts';
import { PriceBook } from '@ormicode/pricing';
import { serve, defaultSocketPath, ormicodeDir, type Link } from './socket.ts';
import { allocateSessionPorts } from './session-ports.ts';
import { workerEnvironment } from './worker-env.ts';
import { McpCredentials } from './mcp-auth.ts';
import { TeamApprovals } from './team-approvals.ts';
import { TeamLifecycle } from './team-lifecycle.ts';
import { UserInteractions } from './user-interactions.ts';
import { beforeWorkerResume, resumeSession, resumeQueuedChildren, workerReadiness } from './team-resume.ts';
import { rateRetries } from './rate-retry.ts';
import { PreviewProxy } from './preview-proxy.ts';
import { Services } from './services.ts';
import { AgentBrowser } from './agent-browser.ts';
import { CheckpointScreenshotScheduler, checkpointSnapshot } from './checkpoint-screenshots.ts';
import { UiCheckFollowupGuard } from './ui-check.ts';
import { finishTurnCheckpoints, recordToolCheckpoint, startTurnCheckpoints } from './turn-checkpoints.ts';
import { runSessionHook } from './workspace-hooks.ts';
import { stateFor } from './supervisor-state.ts';
const WORKER_MAIN = join(dirname(fileURLToPath(import.meta.url)), 'worker-main.ts');
const startedAt = Date.now();
interface Worker { proc: ChildProcess; session: string; pid: number | undefined; ready: boolean }
type HeldPrompt = { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' };
export interface DaemonOptions { socketPath?: string; storePath?: string; mcpCredentials?: McpCredentials }
export async function startDaemon(opts: DaemonOptions = {}) {
  let socketPath = opts.socketPath ?? process.env.ORMICODE_SOCKET ?? defaultSocketPath();
  const storePath = opts.storePath ?? process.env.ORMICODE_STORE ?? join(ormicodeDir(), 'store.db');
  const db = openStore(storePath);
  const mcpCredentials = opts.mcpCredentials ?? new McpCredentials();
  let dispatchCtx: DispatchCtx;
  const previewProxy = new PreviewProxy();
  await previewProxy.listen();
  if (socketPath !== defaultSocketPath() && existsSync(socketPath)) rmSync(socketPath);
  const workers = new Map<string, Worker>();
  const clients = new Set<Client>();
  let lastError: string | null = null;
  let closing = false;
  const notesDir = join(ormicodeDir(), 'notes');
  const paused = new Set<string>();
  const heldPrompts = new Map<string, HeldPrompt[]>();
  const lastPrompt = new Map<string, { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' }>();
  const idleTimers = new Map<string, NodeJS.Timeout>();
  const idleTimeoutMs = Number(process.env.ORMICODE_IDLE_TIMEOUT_MS ?? 20 * 60_000);
  const poolMax = Number(process.env.ORMICODE_POOL_MAX ?? 8);
  const checkpoints = new Checkpoints(join(ormicodeDir(), 'checkpoints'), {
    max: Number(process.env.ORMICODE_CHECKPOINTS_MAX ?? DEFAULT_LIMITS.max),
    maxBytes: Number(process.env.ORMICODE_CHECKPOINTS_MAX_BYTES ?? DEFAULT_LIMITS.maxBytes),
  });
  const checkpointsOn = process.env.ORMICODE_CHECKPOINTS !== '0';
  const secrets = new SecretBroker(join(ormicodeDir(), 'logs', 'secrets-audit.jsonl'), join(ormicodeDir(), 'secrets-index.json'));
  const toolNames = new Map<string, string>();
  const uiCheckFollowups = new UiCheckFollowupGuard();
  const resuming = new Set<string>();
  const recapPending = new Map<string, number>();
  sweepLogs();
  const recovery = recoverSessions(db, resumePolicy());
  const fanout = (session: string, frame: string) => {
    for (const c of clients) if (c.subscriptions.has(session) && !c.link.closed) c.link.send(JSON.parse(frame));
  };
  const delta = (session: string, kind: string, text: string) => {
    text = mcpCredentials.redact(text);
    for (const c of clients) if (c.subscriptions.has(session) && !c.link.closed)
      c.link.send({ v: 1, type: 'evt', session, ts: Date.now(), body: { kind, text } });
    relay?.sendDelta(session, kind, text);
  };
  const record = (session: string, kind: string, payload: Record<string, unknown>, ts?: number, origin?: string) => {
    if (closing) return;
    dispatchCtx?.teamLifecycle.event(session, kind, payload);
    [kind, payload] = dispatchCtx?.teamApprovals.event(session, kind, payload) ?? [kind, payload];
    const { seq, frame } = append(db, session, { kind, payload: { kind, ...secrets.redact(session, mcpCredentials.redact(payload)) }, ...(ts ? { ts } : {}), ...(origin ? { origin } : {}) });
    fanout(session, frame); relay?.sendEvt(session, seq, JSON.parse(frame));
    const mapped = payload.teamMessage ? undefined : stateFor[kind];
    if (mapped) setState(db, session, mapped, typeof payload.reason === 'string' ? payload.reason : undefined, ts);
    else if (kind === 'state' && typeof payload.state === 'string') setState(db, session, payload.state as SessionState, typeof payload.reason === 'string' ? payload.reason : undefined, ts);
  };
  const terminals = new TerminalHub(record, ormicodeDir());
  const services = new Services(db, previewProxy, record, ormicodeDir());
  const agentBrowser = new AgentBrowser(ormicodeDir(), services);
  const pendingWorkers = new Set<string>();
  const spawnFailures = new Map<string, Error>();
  const snapshotCheckpoint = checkpointSnapshot(checkpoints, db, record, () => checkpointsOn, ormicodeDir(), (session, error) => {
    lastError = `checkpoint ${session}: ${error instanceof Error ? error.message : String(error)}`;
  });
  const turnCheckpoints = new CheckpointScreenshotScheduler(snapshotCheckpoint,
    (session, checkpoint, files, startedAt, consoleAfter, shouldCheck) => agentBrowser.captureCheckpoint(session, checkpoint, files, startedAt, consoleAfter, record, shouldCheck),
    (session, files) => agentBrowser.shouldRunUiCheck(session, files));
  const spawnWorker = (session: string) => {
    const row = getSession(db, session);
    if (!row) throw new Error(`unknown session ${session}`);
    const base = getSessionPorts(db, session);
    if (base === undefined) {
      if (pendingWorkers.has(session) || workers.has(session)) return;
      pendingWorkers.add(session);
      void allocateSessionPorts(db, session).then(() => {
        pendingWorkers.delete(session);
        spawnWorker(session);
      }).catch(error => {
        pendingWorkers.delete(session);
        spawnFailures.set(session, error instanceof Error ? error : new Error(String(error)));
      });
      return;
    }
    if (!checkpoints.repo(session).exists()) void snapshotCheckpoint(session, 0, 'baseline');
    const waking = Boolean(db.prepare("SELECT 1 FROM events WHERE session = ? AND kind = 'turn_start' LIMIT 1").get(session));
    const mcpToken = mcpCredentials.issue(session);
    const proc = spawn(process.execPath, [WORKER_MAIN], {
      env: workerEnvironment(row, base, socketPath, secrets, mcpToken),
      stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32',
    });
    const worker: Worker = { proc, session, pid: proc.pid, ready: false };
    workers.set(session, worker);
    setState(db, session, 'starting');
    proc.on('exit', code => {
      mcpCredentials.revoke(session, mcpToken);
      if (closing) return;
      dispatchCtx.teamLifecycle.unavailable(session);
      const wasResuming = resuming.delete(session);
      retries.cancel(session);
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
    if (waking) void runSessionHook(row, 'resume', base, record); return worker;
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
        let recap = false;
        if (w) {
          w.ready = true; w.pid = Number(body.pid) || w.pid; setWorkerPid(db, session, w.pid ?? null); setState(db, session, 'idle'); armIdle(session, 'idle'); enforcePool();
          dispatchCtx.teamLifecycle.available(session);
          if (resuming.delete(session)) record(session, 'resumed', {});
          const uptoSeq = recapPending.get(session);
          if (uptoSeq !== undefined) {
            recapPending.delete(session);
            recap = true;
            const brief = handoffBrief(db, session, 12, uptoSeq);
            record(session, 'handoff_brief', { text: brief });
            void sendPrompt(session, `You are resuming work after a conversation rewind. Context recap:\n${brief}\nContinue where the session left off.`, undefined, { journal: false });
          }
        }
        answer({ ok: true });
        resumeQueuedChildren(dispatchCtx, session);
        if (!recap) void drainQueue(session);
        break;
      }
      case 'worker.event': {
        let kind = String(body.kind);
        dispatchCtx.teamLifecycle.event(session, kind, body.payload as Record<string, unknown>);
        if (kind === 'text_delta' || kind === 'thinking_delta') {
          delta(session, kind, String((body.payload as Record<string, unknown>)?.text ?? ''));
          return answer({ seq: 0 });
        }
        // A stream that ends while no turn is in flight is a clean stop, not a crash.
        if (kind === 'interrupted' && (body.payload as Record<string, unknown>)?.reason === 'stream_ended'
            && !['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying'].includes(getSession(db, session)?.state ?? '')) {
          return answer({ seq: 0 });
        }
        if (kind === 'turn_start') startTurnCheckpoints(session, services, turnCheckpoints, handoffsInTurn);
        let payload = secrets.redact(session, mcpCredentials.redact(body.payload as Record<string, unknown>));
        [kind, payload] = dispatchCtx.teamApprovals.event(session, kind, payload);
        const { seq } = append(db, session, { kind, payload: { kind, ...payload }, ts: Number(body.ts) || Date.now() });
        const frameOut = JSON.stringify({ v: 1, type: 'evt', session, seq, ts: Number(body.ts) || Date.now(), body: { kind, ...payload } });
        fanout(session, frameOut);
        relay?.sendEvt(session, seq, JSON.parse(frameOut));
        idxSoon();
        recordToolCheckpoint(session, kind, payload, seq, toolNames, turnCheckpoints);
        const mapped = stateFor[kind];
        if (mapped) {
          setState(db, session, mapped, typeof payload?.reason === 'string' ? payload.reason as string : undefined);
          armIdle(session, mapped);
        }
        if (kind === 'error' && typeof payload?.resetAt === 'number'
            && (payload.code === 'rate_limited' || payload.code === 'plan_limit')) {
          setState(db, session, 'paused_rate_limited', String(payload.code));
          retries.schedule(session, payload.resetAt);
        }
        answer({ seq });
        if (kind === 'turn_end') finishTurnCheckpoints(session, turnCheckpoints, uiCheckFollowups, enqueueAutoPrompt, record, drainQueue);
        if (kind === 'interrupted') void drainQueue(session, true, true);
        break;
      }
      case 'worker.state':
        setState(db, session, body.state as SessionState, body.reason as string | undefined);
        dispatchCtx.teamLifecycle.event(session, 'state', body);
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
    mcpCredentials.revoke(session); dispatchCtx.teamLifecycle.unavailable(session);
    const w = workers.get(session);
    const link = workerLinks.get(session);
    if (link) { try { await link.request('worker.evict', { session }, 10_000); } catch { if (w) killTree(w.proc); } }
    else if (w) killTree(w.proc);
    workers.delete(session);
    record(session, 'evicted', { reason, idleMs: 0 });
    setState(db, session, 'idle', reason);
  };
  const stopWorker = async (session: string) => {
    mcpCredentials.revoke(session); dispatchCtx.teamLifecycle.unavailable(session);
    const w = workers.get(session);
    if (!w) return;
    const link = workerLinks.get(session);
    if (link) {
      try { await link.request('worker.evict', { session }, 10_000); }
      catch { killTree(w.proc); }
    } else killTree(w.proc);
    workers.delete(session);
    setWorkerPid(db, session, null);
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
    const cancelled = method === 'worker.abort' && expireHandoffApprovals(dispatchCtx, session, 'cancelled');
    const w = workers.get(session);
    const link = workerLinks.get(session);
    const response = w && link ? await link.request(method, { session, ...body }, 30_000) : undefined;
    return cancelled && response?.type !== 'res' ? { v: 1, type: 'res', id: 'worker.abort', ok: true, body: { interrupted: true } } as Frame : response;
  };
  const workerLinks = new Map<string, Link>();
  const sessionByLink = new Map<Link, string>();
  const ensureWorker = workerReadiness({
    ready: session => Boolean(workers.get(session)?.ready), exists: session => workers.has(session),
    pending: session => pendingWorkers.has(session), spawn: spawnWorker,
    failure: session => { const error = spawnFailures.get(session); spawnFailures.delete(session); return error; },
    before: session => beforeWorkerResume(dispatchCtx, session, () => closing), closed: () => closing,
  });
  const { sendPrompt, drainQueue, enqueueAutoPrompt } = createPromptDelivery({
    db, notesDir, paused, heldPrompts, lastPrompt, ensureWorker, toWorker, terminals, record, closed: () => closing,
    previewEntries: (session, ids) => services.previewEntries(session, ids),
  });
  const retries = rateRetries(db, session => {
    const last = lastPrompt.get(session);
    return last ? sendPrompt(session, last.text, last.images, { journal: false, context: last.context, attachments: last.attachments, actor: last.actor }) : undefined;
  });
  const pairing = new Pairing();
  const handoffsInTurn = new Map<string, number>();
  let relay: RelayClient | undefined;
  dispatchCtx = {
    teamLifecycle: new TeamLifecycle(() => dispatchCtx, session => Boolean(workers.get(session)?.ready) && workerLinks.has(session) && mcpCredentials.activeFor(session)),
    interactions: new UserInteractions(() => dispatchCtx),
    teamApprovals: new TeamApprovals(() => dispatchCtx, session => workers.has(session) && mcpCredentials.activeFor(session)),
    db, notesDir, startedAt, paused, heldPrompts, lastPrompt, handoffsInTurn, mcpCredentials,
    lastError: () => lastError, liveWorkers: () => workers.size,
    spawnWorker, ensureWorker, stopWorker, setRecapPending: (session, uptoSeq) => recapPending.set(session, uptoSeq), toWorker, sendPrompt, drainQueue,
    resetUiCheckFollowups: session => uiCheckFollowups.reset(session),
    pairing, relay: () => relay, checkpoints, record, secrets, terminals, services, agentBrowser,
    prices: new PriceBook({
      cachePath: join(ormicodeDir(), 'cache', 'prices.json'), overridesPath: join(ormicodeDir(), 'prices.json'),
      url: process.env.ORMICODE_PRICES_URL === 'off' ? null : process.env.ORMICODE_PRICES_URL,
      maxAgeMs: (Number(process.env.ORMICODE_PRICING_CACHE_MINUTES) || 1440) * 60_000,
    }),
  };
  dispatchCtx.teamLifecycle.start();
  // idx summaries keep remote session lists fresh without streaming transcripts.
  let idxTimer: NodeJS.Timeout | undefined;
  const pushIdx = (to: string) => {
    if (!relay || closing) return;
    relay.sendIdx(to, listSessions(db).map(s => ({ id: s.id, state: s.state, title: s.title, updatedAt: s.updated_at })));
  };
  const idxSoon = () => {
    if (idxTimer) return;
    idxTimer = setTimeout(() => { idxTimer = undefined; pushIdx('*'); }, 1_000);
    idxTimer.unref();
  };
  const hubConfig = loadHubConfig();
  if (hubConfig) {
    relay = new RelayClient(hubConfig, {
      onPairJoin: (join, code, name) => {
        void handleJoin(pairing, db, code, name).then(r => {
          relay?.pairResult(join, r.ok ? { ok: true, device: r.device, name: r.name, tokenHash: r.tokenHash, token: r.token, codeHash: r.codeHash } : { ok: false });
        });
      },
      onRequest: (link, frame) => {
        const client: Client = { link, subscriptions: new Set(), device: (link as RemoteLink).device ?? 'remote' };
        void onClientFrame(dispatchCtx, client, frame);
      },
      onDeviceOnline: device => pushIdx(device),
      onState: connected => { if (!connected) lastError ??= 'relay disconnected'; },
    });
    relay.start();
  }
  const server = await serve(socketPath, link => {
    link.onFrame = frame => {
      if (closing) return;
      if (frame.type === 'req' && typeof frame.method === 'string' && frame.method.startsWith('worker.')) {
        const session = String((frame.body as Record<string, unknown>).session ?? '');
        if (frame.method === 'worker.ready') { workerLinks.set(session, link); sessionByLink.set(link, session); }
        onWorkerFrame(link, frame);
      } else {
        let client = [...clients].find(c => c.link === link);
        if (frame.type === 'hello') {
          if (!client) { client = { link, subscriptions: new Set(), device: 'cli' }; clients.add(client); }
          if (typeof frame.device === 'string' && frame.device) client.device = frame.device;
          return;
        }
        if (!client) { client = { link, subscriptions: new Set(), device: 'cli' }; clients.add(client); }
        void onClientFrame(dispatchCtx, client, frame);
      }
    };
    link.onClose = () => {
      for (const c of clients) if (c.link === link) { clients.delete(c); dispatchCtx.terminals.drop(c); }
      const s = sessionByLink.get(link);
      if (s) { sessionByLink.delete(link); if (workerLinks.get(s) === link) { workerLinks.delete(s); mcpCredentials.revoke(s); dispatchCtx.teamLifecycle.unavailable(s); } }
    };
  });
  const addr = server.address();
  if (typeof addr === 'object' && addr) socketPath = `127.0.0.1:${addr.port}`;
  for (const c of recovery.autoResume) { resuming.add(c.s.id); if (c.recapOnly) recapPending.set(c.s.id, Number.MAX_SAFE_INTEGER); void resumeSession(dispatchCtx, c.s.id).catch(error => { lastError = String(error); }); }
  for (const r of recovery.rateLimited) retries.schedule(r.id, r.resetAt);
  return {
    socketPath, storePath, db, workers,
    async close() {
      await agentBrowser.closeAll();
      await services.shutdown();
      await previewProxy.close();
      expireHandoffApprovals(dispatchCtx, undefined, 'daemon_shutdown');
      dispatchCtx.interactions.close(); closing = true;
      dispatchCtx.teamLifecycle.close();
      if (idxTimer) clearTimeout(idxTimer);
      for (const t of idleTimers.values()) clearTimeout(t);
      idleTimers.clear();
      retries.close();
      for (const w of workers.values()) {
        const link = workerLinks.get(w.session);
        try { await link?.request('worker.evict', { session: w.session }, 5_000); } catch { /* kill below */ }
        try { killTree(w.proc); } catch { /* already dead */ }
      }
      for (const c of clients) c.link.close();
      for (const link of workerLinks.values()) link.close();
      mcpCredentials.clear();
      relay?.close();
      server.close();
      db.close();
    },
  };
}
