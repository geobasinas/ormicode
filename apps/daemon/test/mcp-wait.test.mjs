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
      return { type: 'res', body: { state: 'idle' } };
    }
  });
  assert.deepEqual(JSON.parse(await waitFor(link, 'child', 'idle', 100, proof)), { state: 'idle' });
});

test('live completion reports authoritative team status in every wait mode', async () => {
  for (const until of ['idle', 'done', 'approval']) {
    let state = 'running';
    const { link } = fixture(method => {
      if (method === 'team.status') return { type: 'res', body: { state } };
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
    const { link } = fixture((method, link) => {
      if (method === 'session.subscribe' && dispatched) {
        link.onFrame(event('turn_end'));
        link.onFrame({ ...event('state'), body: { kind: 'state', state: 'starting', reason: 'prompt_dispatch' } });
      }
      if (method === 'session.get') return { type: 'res', body: { state: 'idle' } };
    });
    let settled = false;
    const waiting = waitFor(link, 'child', 'idle', 1000, proof).then(result => { settled = true; return JSON.parse(result); });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    link.onFrame(event('turn_start'));
    link.onFrame(event('turn_end'));
    assert.deepEqual(await waiting, { state: 'idle' });
  }
});

test('MCP wait accepts a completed task from replay even if it finished before subscription', async () => {
  const { link } = fixture((method, link) => {
    if (method === 'session.subscribe') { link.onFrame(event('turn_start')); link.onFrame(event('turn_end')); }
    if (method === 'session.get') return { type: 'res', body: { state: 'idle' } };
  });
  assert.deepEqual(JSON.parse(await waitFor(link, 'child', 'idle', 100, proof)), { state: 'idle' });
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
      assert.equal(calls.includes('session.unsubscribe'), failure === 'session.get');
    }
  }
});
