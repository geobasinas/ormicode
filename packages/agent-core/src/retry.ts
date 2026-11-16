import { AgentError } from './errors.ts';

export const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000] as const;
export type RetryEvent = { kind: 'rate_limited'; attempt: number } | { kind: 'retry_scheduled'; delayMs: number };
export type RetryResult<T> = { status: 'ok'; value: T } | { status: 'paused'; error: AgentError; resetAt?: number };

function sleepChunk(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // Timers above 2^31-1 ms overflow in Node and can otherwise retry immediately.
  while (ms > 0) {
    const chunk = Math.min(ms, 2_147_483_647);
    await sleepChunk(chunk, signal);
    ms -= chunk;
  }
}

/** Only call for a provider operation the adapter can retry without duplicating effects. */
export async function retryRateLimit<T>(
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; onEvent?: (event: RetryEvent) => void; wait?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<RetryResult<T>> {
  let retries = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    try { return { status: 'ok', value: await operation() }; }
    catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof AgentError) || (error.code !== 'rate_limited' && error.code !== 'overloaded' && error.code !== 'plan_limit')) throw error;
      if (error.code === 'plan_limit' || retries === RETRY_DELAYS_MS.length) {
        return { status: 'paused', error, ...(error.resetAt === undefined ? {} : { resetAt: error.resetAt }) };
      }
      const delayMs = Math.max(RETRY_DELAYS_MS[retries]!, error.retryAfterMs ?? 0);
      retries += 1;
      options.onEvent?.({ kind: 'rate_limited', attempt: retries });
      options.onEvent?.({ kind: 'retry_scheduled', delayMs });
      await (options.wait ?? sleep)(delayMs, options.signal);
    }
  }
}
