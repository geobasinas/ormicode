import type { PromptContext } from '@ormicode/protocol';
import type { CheckpointScreenshotScheduler } from './checkpoint-screenshots.ts';
import { recordUiCheckResult, type UiCheckFollowupGuard } from './ui-check.ts';

type RecordEvent = (session: string, kind: string, payload: Record<string, unknown>) => void;
type AutoEnqueue = (session: string, text: string, context: PromptContext[]) => void;
type DrainQueue = (session: string, afterTurnEnd?: boolean) => Promise<boolean>;

export function startTurnCheckpoints(
  session: string,
  services: { previewConsole(session: string): { next: number } },
  scheduler: CheckpointScreenshotScheduler,
  handoffsInTurn: Map<string, number>,
): void {
  handoffsInTurn.delete(session);
  let consoleAfter = 0;
  try { consoleAfter = services.previewConsole(session).next; } catch { /* The UI check can still run without a cursor. */ }
  scheduler.start(session, consoleAfter);
}

export function recordToolCheckpoint(
  session: string,
  kind: string,
  payload: Record<string, unknown>,
  seq: number,
  toolNames: Map<string, string>,
  scheduler: CheckpointScreenshotScheduler,
): void {
  if (kind === 'tool_call') toolNames.set(`${session}/${String(payload.callId)}`, String(payload.name ?? 'tool'));
  else if (kind === 'tool_result') {
    const key = `${session}/${String(payload.callId)}`;
    scheduler.checkpoint(session, seq, toolNames.get(key) ?? 'tool');
    toolNames.delete(key);
  }
}

export function finishTurnCheckpoints(
  session: string,
  scheduler: CheckpointScreenshotScheduler,
  followups: UiCheckFollowupGuard,
  enqueue: AutoEnqueue,
  record: RecordEvent,
  drainQueue: DrainQueue,
  timeoutMs = 15_000,
): void {
  let timedOut = false;
  let drained = false;
  const drain = () => { if (!drained) { drained = true; void drainQueue(session, true); } };
  const timer = setTimeout(() => { timedOut = true; drain(); }, timeoutMs);
  void scheduler.end(session).then(capture => {
    if (!capture) { clearTimeout(timer); return drain(); }
    if (!capture.shouldCheck) {
      clearTimeout(timer);
      drain();
      void capture.result.then(result => {
        if (result) recordUiCheckResult(session, result, followups, enqueue, record, false);
      });
      return;
    }
    if (timedOut) {
      void capture.result.then(result => {
        if (result) recordUiCheckResult(session, result, followups, enqueue, record, false);
      });
      return;
    }
    void capture.result.then(result => {
      clearTimeout(timer);
      if (result) recordUiCheckResult(session, result, followups, enqueue, record, !timedOut);
      if (!timedOut) drain();
    }).catch(() => { clearTimeout(timer); drain(); });
  }).catch(() => { clearTimeout(timer); drain(); });
}
