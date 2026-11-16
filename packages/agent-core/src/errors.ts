export const agentErrorCodes = ['rate_limited', 'plan_limit', 'auth', 'context_exceeded', 'binary_missing', 'crashed', 'overloaded', 'unknown'] as const;
export type AgentErrorCode = (typeof agentErrorCodes)[number];

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly retryAfterMs: number | undefined;
  readonly resetAt: number | undefined;
  constructor(code: AgentErrorCode, message: string, options: { retryAfterMs?: number; resetAt?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    for (const value of [options.retryAfterMs, options.resetAt]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new RangeError('Retry and reset times must be finite non-negative numbers');
      }
    }
    this.name = 'AgentError';
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.resetAt = options.resetAt;
  }
}
