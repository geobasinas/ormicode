import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitFor } from '../src/mcp-wait.ts';

const proof = { session: 'parent', token: 'test' };
const event = (kind, session = 'child') => ({ type: 'evt', session, body: { kind } });

function fixture(handle) {
  const calls = [];
  const link = { onFrame: undefined, async request(method, body, timeout, auth) {
    assert.deepEqual(auth, proof);
    calls.push(method);
    return await handle(method, link) ?? { type: 'res', body: {} };
  } };
  return { link, calls };
}

test('MCP wait rechecks state after subscribing when completion precedes the subscription reply', async () => {
  for (const until of ['idle', 'done', 'approval']) {
    const { link, calls } = fixture((method, link) => {
      if (method === 'session.subscribe') link.onFrame(event('turn_end'));
      if (method === 'session.get') return { type: 'res', body: { state: 'done' } };
    });
    assert.deepEqual(JSON.parse(await waitFor(link, 'child', until, 100, proof)), { state: 'done' });
    assert.deepEqual(calls, ['session.subscribe', 'session.get', 'session.unsubscribe']);
    assert.equal(link.onFrame, undefined);
  }
});

test('MCP wait catches live completion during the status request and ignores other sessions', async () => {
  let first = true;
  const { link } = fixture((method, link) => {
    if (method === 'session.get') {
      if (first) {
        first = false;
        link.onFrame(event('error', 'other'));
        link.onFrame(event('turn_end'));
        return { type: 'res', body: { state: 'running' } };
      }
      return { type: 'res', body: { state: 'idle', turnCompleted: true } };
    }
  });
  assert.deepEqual(JSON.parse(await waitFor(link, 'child', 'idle', 100, proof)), { state: 'idle' });
});

test('live completion reports authoritative team status in every wait mode', async () => {
  for (const until of ['idle', 'done', 'approval']) {
    let state = 'running';
    const { link } = fixture(method => {
      if (method === 'team.status') return { type: 'res', body: { state, turnCompleted: state === 'idle' } };
    });
    const waiting = waitFor(link, 'child', until, 1000, proof, true).then(JSON.parse);
    await new Promise(resolve => setImmediate(resolve));
    state = until === 'approval' ? 'awaiting_input' : 'idle';
    link.onFrame(event(until === 'approval' ? 'question_request' : 'turn_end'));
    assert.deepEqual(await waiting, { state });
  }
});

test('MCP wait ignores historical completion and times out with current state', async () => {
  const { link, calls } = fixture((method, link) => {
    if (method === 'session.subscribe') link.onFrame(event('turn_end'));
    if (method === 'session.get') return { type: 'res', body: { state: 'running' } };
  });
  assert.deepEqual(JSON.parse(await waitFor(link, 'child', 'idle', 1, proof)), { timedOut: true, state: 'running' });
  assert.equal(calls.at(-1), 'session.unsubscribe');
});

test('MCP wait does not mistake an acknowledged pending task or an unused idle session for completion', async () => {
  for (const dispatched of [false, true]) {
    let turnCompleted = false;
    const { link } = fixture((method, link) => {
      if (method === 'session.subscribe' && dispatched) {
        link.onFrame(event('turn_end'));
        link.onFrame({ ...event('state'), body: { kind: 'state', state: 'starting', reason: 'prompt_dispatch' } });
      }
      if (method === 'session.get') return { type: 'res', body: { state: 'idle', turnCompleted } };
    });
    let settled = false;
    const waiting = waitFor(link, 'child', 'idle', 1000, proof).then(result => { settled = true; return JSON.parse(result); });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    link.onFrame(event('turn_start'));
    turnCompleted = true;
    link.onFrame(event('turn_end'));
    assert.deepEqual(await waiting, { state: 'idle' });
  }
});

test('MCP wait accepts a completed task from replay even if it finished before subscription', async () => {
  const { link } = fixture((method, link) => {
    if (method === 'session.subscribe') { link.onFrame(event('turn_start')); link.onFrame(event('turn_end')); }
    if (method === 'session.get') return { type: 'res', body: { state: 'idle', turnCompleted: true } };
  });
  assert.deepEqual(JSON.parse(await waitFor(link, 'child', 'idle', 100, proof)), { state: 'idle' });
});

test('approval decisions refresh the timeout state while the turn keeps running', async () => {
  for (const team of [false, true]) {
    let state = 'awaiting_approval';
    const { link, calls } = fixture(method => {
      if (method === (team ? 'team.status' : 'session.get')) return { type: 'res', body: { state, turnCompleted: false } };
    });
    const waiting = waitFor(link, 'child', 'idle', 50, proof, team).then(JSON.parse);
    await new Promise(resolve => setImmediate(resolve));
    state = 'running'; link.onFrame(event('approval_decision'));
    assert.deepEqual(await waiting, { timedOut: true, state: 'running' });
    assert.equal(calls.filter(method => method === (team ? 'team.status' : 'session.get')).length, 2);
  }
});

test('every session journal event re-evaluates authoritative status without event-specific inference', async () => {
  for (const kind of ['approval_decision', 'question_answer', 'interaction_expired', 'team_message', 'handoff_completed', 'future_event']) {
    let state = 'running';
    const { link } = fixture(method => {
      if (method === 'team.status') return { type: 'res', body: { state, turnCompleted: false } };
    });
    const waiting = waitFor(link, 'child', 'approval', 1000, proof, true).then(JSON.parse);
    await new Promise(resolve => setImmediate(resolve));
    state = 'awaiting_input'; link.onFrame(event(kind));
    assert.deepEqual(await waiting, { state });
  }
});

test('MCP wait cleans up on subscription/status errors and restores the existing listener', async () => {
  for (const failure of ['session.subscribe', 'session.get']) {
    for (const throws of [false, true]) {
      const { link, calls } = fixture(method => {
        if (method !== failure) return;
        if (throws) throw new Error('connection closed');
        return { type: 'err', code: 'mcp.forbidden' };
      });
      const listener = () => {};
      link.onFrame = listener;
      const waiting = waitFor(link, 'child', 'idle', 100, proof);
      if (throws) await assert.rejects(waiting, /connection closed/);
      else assert.deepEqual(JSON.parse(await waiting), { error: 'mcp.forbidden' });
      assert.equal(link.onFrame, listener);
      assert.equal(calls.includes('session.unsubscribe'), true);
    }
  }
});

test('MCP wait deadline includes stalled setup and cleanup, with late subscription cleanup', async () => {
  for (const stalled of ['session.subscribe', 'session.get', 'session.unsubscribe']) {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const calls = [];
    const previous = () => {};
    const link = { onFrame: previous, async request(method, body, timeout) {
      assert.ok(timeout > 0 && timeout <= 20);
      calls.push(method);
      if (method === stalled) return blocked;
      return { type: 'res', body: { state: 'running' } };
    } };
    const start = performance.now();
    assert.deepEqual(JSON.parse(await waitFor(link, 'child', 'idle', 20, proof)),
      { timedOut: true, ...(stalled === 'session.unsubscribe' ? { state: 'running' } : {}) });
    assert.ok(performance.now() - start < 500, 'must not wait for the stalled request');
    assert.equal(link.onFrame, previous);
    assert.equal(calls.filter(method => method === 'session.unsubscribe').length, 1, 'cleanup must precede any late subscription reply');
    release({ type: 'res', body: { state: 'idle' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(method => method === 'session.unsubscribe').length, 1);
  }
});
