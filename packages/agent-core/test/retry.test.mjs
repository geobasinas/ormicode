import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentError, retryRateLimit } from '../src/index.ts';

test('retries structured rate limits and honors longer provider delay', async () => {
  const delays = []; const events = []; let calls = 0;
  const result = await retryRateLimit(async () => {
    if (++calls < 3) throw new AgentError('rate_limited', 'slow', { retryAfterMs: 5000 });
    return 'ok';
  }, { wait: async (ms) => { delays.push(ms); }, onEvent: (event) => events.push(event) });
  assert.deepEqual(result, { status: 'ok', value: 'ok' });
  assert.deepEqual(delays, [5000, 5000]);
  assert.equal(events.length, 4);
});

test('pauses after five retries, and plan limits pause without retries', async () => {
  let calls = 0; const delays = [];
  const result = await retryRateLimit(async () => { calls++; throw new AgentError('rate_limited', 'slow', { resetAt: 100 }); }, { wait: async (ms) => delays.push(ms) });
  assert.equal(result.status, 'paused');
  assert.equal(result.resetAt, 100);
  assert.equal(calls, 6);
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 32000]);
  calls = 0;
  const plan = await retryRateLimit(async () => { calls++; throw new AgentError('plan_limit', 'quota'); });
  assert.equal(plan.status, 'paused');
  assert.equal(calls, 1);
});

test('does not retry unknown errors and honors cancellation', async () => {
  const error = new Error('not classified');
  await assert.rejects(retryRateLimit(async () => { throw error; }), (e) => e === error);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(retryRateLimit(async () => 'unreachable', { signal: controller.signal }), /cancelled/);
});

test('cancellation interrupts a pending retry and invalid timing is rejected', async () => {
  const controller = new AbortController();
  const pending = retryRateLimit(async () => { throw new AgentError('rate_limited', 'wait'); }, {
    signal: controller.signal,
    onEvent: (event) => { if (event.kind === 'retry_scheduled') controller.abort(new Error('stopped')); },
  });
  await assert.rejects(pending, /stopped/);
  assert.throws(() => new AgentError('rate_limited', 'bad', { retryAfterMs: Infinity }), RangeError);
  assert.throws(() => new AgentError('rate_limited', 'bad', { resetAt: -1 }), RangeError);
});
