/** Worker→hub request handling, extracted from supervisor.ts to keep it under the size cap. */
import type { ChildProcess } from 'node:child_process';
import type { Frame } from '@ormicode/protocol';
import { append } from '@ormicode/journal';
import { getSession, setNativeId, setState, setWorkerPid, type SessionState, type Store } from '@ormicode/session-store';
import { stateFor } from './supervisor-state.ts';
import type { Link } from './socket.ts';
import type { DispatchCtx } from './dispatch.ts';
import type { RelayClient } from './relay.ts';
import type { SecretBroker } from './secrets.ts';
import type { McpCredentials } from './mcp-auth.ts';
import type { CheckpointScreenshotScheduler } from './checkpoint-screenshots.ts';
import type { UiCheckFollowupGuard } from './ui-check.ts';
import type { Resources } from './resources.ts';
import { overMemoryCap } from './worker-scope.ts';
import { closeInterruptedTools } from './interrupted-tools.ts';
import { finishTurnCheckpoints, recordToolCheckpoint, startTurnCheckpoints } from './turn-checkpoints.ts';
import { resumeQueuedChildren } from './team-resume.ts';
import { handoffBrief } from './handoff.ts';
import { shouldRecordResume } from './resume-marker.ts';
import type { createPromptDelivery } from './prompt-delivery.ts';
import type { rateRetries } from './rate-retry.ts';

export interface Worker { proc: ChildProcess; session: string; pid: number | undefined; ready: boolean; stopping?: boolean }
type PromptDelivery = ReturnType<typeof createPromptDelivery>;
type RecordEvent = (session: string, kind: string, payload: Record<string, unknown>, ts?: number, origin?: string) => void;

export interface WorkerFrameContext {
  db: Store;
  workers: Map<string, Worker>;
  dispatchCtx: DispatchCtx;
  delta(session: string, kind: string, text: string): void;
  fanout(session: string, frame: string): void;
  relay(): RelayClient | undefined;
  idxSoon(): void;
  toolNames: Map<string, string>;
  turnCheckpoints: CheckpointScreenshotScheduler;
  handoffsInTurn: Map<string, number>;
  resuming: Set<string>;
  recapPending: Map<string, number>;
  retries: ReturnType<typeof rateRetries>;
  uiCheckFollowups: UiCheckFollowupGuard;
  secrets: SecretBroker;
  mcpCredentials: McpCredentials;
  resources: Resources;
  record: RecordEvent;
  isSending(session: string): boolean;
  armIdle(session: string, state: SessionState): void;
  enforcePool(fresh: string): void;
  stopWorker(session: string, force?: boolean): Promise<void>;
  sendPrompt: PromptDelivery['sendPrompt'];
  drainQueue: PromptDelivery['drainQueue'];
  enqueueAutoPrompt: PromptDelivery['enqueueAutoPrompt'];
}

export function createWorkerFrameHandler(ctx: WorkerFrameContext) {
  const { db, workers, dispatchCtx } = ctx;
  return (link: Link, frame: Frame) => {
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
          w.ready = true; w.pid = Number(body.pid) || w.pid; setWorkerPid(db, session, w.pid ?? null);
          // A prompt may already be waiting on this worker. Stay off the idle
          // evict list so pool pressure cannot drop it before the turn starts.
          if (!ctx.isSending(session)) { setState(db, session, 'idle'); ctx.armIdle(session, 'idle'); }
          ctx.enforcePool(session);
          dispatchCtx.teamLifecycle.available(session);
          if (ctx.resuming.delete(session) && shouldRecordResume(db, session)) ctx.record(session, 'resumed', {});
          const uptoSeq = ctx.recapPending.get(session);
          if (uptoSeq !== undefined) {
            ctx.recapPending.delete(session);
            recap = true;
            const brief = handoffBrief(db, session, 12, uptoSeq);
            ctx.record(session, 'handoff_brief', { text: brief });
            void ctx.sendPrompt(session, `You are resuming work after a conversation rewind. Context recap:\n${brief}\nContinue where the session left off.`, undefined, { journal: false });
          }
        }
        answer({ ok: true });
        resumeQueuedChildren(dispatchCtx, session);
        if (!recap) void ctx.drainQueue(session);
        break;
      }
      case 'worker.event': {
        let kind = String(body.kind);
        dispatchCtx.teamLifecycle.event(session, kind, body.payload as Record<string, unknown>);
        if (kind === 'text_delta' || kind === 'thinking_delta') {
          ctx.delta(session, kind, String((body.payload as Record<string, unknown>)?.text ?? ''));
          return answer({ seq: 0 });
        }
        // A stream that ends while no turn is in flight is a clean stop, not a crash.
        if (kind === 'interrupted' && (body.payload as Record<string, unknown>)?.reason === 'stream_ended'
            && !['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying'].includes(getSession(db, session)?.state ?? '')) {
          return answer({ seq: 0 });
        }
        if (kind === 'turn_start') startTurnCheckpoints(session, dispatchCtx.services, ctx.turnCheckpoints, ctx.handoffsInTurn);
        if (kind === 'interrupted') closeInterruptedTools(db, session, ctx.record);
        let payload = ctx.secrets.redact(session, ctx.mcpCredentials.redact(body.payload as Record<string, unknown>));
        [kind, payload] = dispatchCtx.teamApprovals.event(session, kind, payload);
        const { seq } = append(db, session, { kind, payload: { kind, ...payload }, ts: Number(body.ts) || Date.now() });
        const frameOut = JSON.stringify({ v: 1, type: 'evt', session, seq, ts: Number(body.ts) || Date.now(), body: { kind, ...payload } });
        ctx.fanout(session, frameOut);
        ctx.relay()?.sendEvt(session, seq, JSON.parse(frameOut));
        ctx.idxSoon();
        recordToolCheckpoint(session, kind, payload, seq, ctx.toolNames, ctx.turnCheckpoints);
        const mapped = stateFor[kind];
        if (mapped) {
          setState(db, session, mapped, typeof payload?.reason === 'string' ? payload.reason as string : undefined);
          ctx.armIdle(session, mapped);
        }
        if (kind === 'error' && typeof payload?.resetAt === 'number'
            && (payload.code === 'rate_limited' || payload.code === 'plan_limit')) {
          setState(db, session, 'paused_rate_limited', String(payload.code));
          ctx.retries.schedule(session, payload.resetAt);
        }
        answer({ seq });
        if (kind === 'turn_end') finishTurnCheckpoints(session, ctx.turnCheckpoints, ctx.uiCheckFollowups, ctx.enqueueAutoPrompt, ctx.record, ctx.drainQueue);
        if (kind === 'interrupted') void ctx.drainQueue(session, true, true);
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
      case 'worker.health': {
        const rss = Number(body.rssBytes);
        ctx.resources.observeWorker(session, rss);
        if (overMemoryCap(rss, ctx.resources.workerMemoryCapBytes())) {
          ctx.record(session, 'interrupted', { reason: 'memory_cap' });
          void ctx.stopWorker(session, true);
        }
        answer({ ok: true });
        break;
      }
      default:
        link.replyError(id, 'protocol.unknown_method', method);
    }
  };
}
