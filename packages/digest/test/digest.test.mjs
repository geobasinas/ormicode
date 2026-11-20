import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, rank } from '../src/index.ts';

const ev = (seq, kind, payload = {}, ts = seq) => ({ seq, ts, kind, payload: { kind, ...payload } });

test('answerable expired questions stay in Needs You until answered; approvals and agent questions expire', () => {
  const session = { id: 's', state: 'idle', updatedAt: 10 };
  const events = [ev(1, 'question_request', { request: 'q' }), ev(2, 'interaction_expired', { request: 'q', answerable: true })];
  assert.equal(summarize(session, events, 0, 100).wants.kind, 'question');
  assert.equal(summarize(session, [...events, ev(3, 'question_answer', { request: 'q' })], 0, 100).wants, null);
  assert.equal(summarize(session, [ev(1, 'question_request', { request: 'q' }), ev(2, 'interaction_expired', { request: 'q' })], 0, 100).wants, null);
  assert.equal(summarize(session, [ev(1, 'approval_request', { request: 'q' }), ev(2, 'interaction_expired', { request: 'q', answerable: true })], 0, 100).wants, null);
});

test('mechanical digest reports only what the events say', () => {
  const events = [
    ev(1, 'tool_call', { callId: 'a', name: 'Edit', input: { file_path: 'src/x.ts' } }),
    ev(2, 'tool_result', { callId: 'a', status: 'completed' }),
    ev(3, 'tool_call', { callId: 'b', name: 'Bash', input: { command: 'pnpm test' } }),
    ev(4, 'tool_result', { callId: 'b', status: 'failed', output: '2 tests failed' }),
    ev(5, 'usage', { input: 100, output: 20 }),
    ev(6, 'approval_request', { request: 'req_1', options: [] }, 600),
  ];
  const e = summarize({ id: 's_1', state: 'awaiting_approval', updatedAt: 600 }, events, 0, 1000);
  assert.deepEqual(e, {
    session: 's_1', rank: 'waiting', source: 'mechanical', changed: { paths: ['src/x.ts'], result: 'Bash: 2 tests failed' },
    wants: { kind: 'approval', since: 600 }, dropped: ['Bash failed'], where: { state: 'awaiting_approval', ageMs: 400 }, cost: { tokens: 120 },
  });
  const decided = summarize({ id: 's_1', state: 'idle', updatedAt: 700 }, [...events, ev(7, 'approval_decision', { request: 'req_1', option: 'allow' })], 0, 1000);
  assert.equal(decided.wants, null); assert.equal(decided.rank, 'progressed');
});

test('no events is silent, and ranking puts waiting first and oldest first within a rank', () => {
  const silent = summarize({ id: 's_q', state: 'idle', updatedAt: 100 }, [], 50, 1000);
  assert.deepEqual(silent, { session: 's_q', rank: 'silent', source: 'mechanical', silentMs: 900 });
  const mk = (id, state, updatedAt) => summarize({ id, state, updatedAt }, [ev(1, 'text', { text: 'hi' })], 0, 1000);
  const sorted = rank([silent, mk('p', 'idle', 900), mk('d', 'done', 900), mk('f1', 'failed', 900), mk('f2', 'interrupted', 100),
    summarize({ id: 'r', state: 'paused_rate_limited', updatedAt: 500 }, [ev(1, 'text', { text: 'x' })], 0, 1000)]);
  assert.deepEqual(sorted.map(e => e.session), ['f2', 'f1', 'd', 'p', 'r', 's_q']);
});

test('only pending user interactions rank waiting, never stale requests on stopped, failed, idle or rate-limited sessions', () => {
  const pending = [ev(1, 'approval_request', { request: 'a' }), ev(2, 'question_request', { request: 'q' })];
  for (const state of ['idle', 'interrupted', 'failed', 'done', 'archived', 'paused_rate_limited']) {
    const digest = summarize({ id: state, state, updatedAt: 1 }, pending, 0, 100);
    assert.notEqual(digest.rank, 'waiting', state);
    if (state === 'failed') assert.equal(digest.rank, 'failed');
  }
  for (const state of ['awaiting_approval', 'awaiting_input', 'running'])
    assert.equal(summarize({ id: state, state, updatedAt: 1 }, pending, 0, 100).rank, 'waiting');
  const stopped = summarize({ id: 'stopped', state: 'interrupted', updatedAt: 3 }, [...pending, ev(3, 'interrupted', { reason: 'user_abort' })], 0, 100);
  assert.equal(stopped.rank, 'progressed'); assert.equal(stopped.wants, null);
  assert.equal(summarize({ id: 'stopped', state: 'interrupted', reason: 'user_abort', updatedAt: 3 }, pending, 0, 100).rank, 'progressed');
  assert.equal(summarize({ id: 'failure', state: 'failed', updatedAt: 3 }, [ev(1, 'error', { code: 'auth', message: 'expired' })], 0, 100).rank, 'failed');
  assert.notEqual(summarize({ id: 'delegated', state: 'awaiting_approval', delegatedApproval: true, updatedAt: 3 }, [ev(1, 'team_approval_request', { request: 'a' })], 0, 100).rank, 'waiting');
  assert.equal(summarize({ id: 'mixed', state: 'awaiting_approval', delegatedApproval: true, updatedAt: 3 }, pending, 0, 100).rank, 'waiting');
});

test('terminal lifecycle events do not make a session digest active', () => {
  const result = summarize({ id: 's_term', state: 'idle', updatedAt: 100 }, [
    ev(1, 'terminal_open', { terminal: 't_1' }, 200),
    ev(2, 'terminal_close', { terminal: 't_1' }, 300),
  ], 50, 1000);
  assert.deepEqual(result, { session: 's_term', rank: 'silent', source: 'mechanical', silentMs: 900 });
});
