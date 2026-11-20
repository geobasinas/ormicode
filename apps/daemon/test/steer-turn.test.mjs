import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, createSession } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { newId } from '@ormicode/protocol';
import { onClientFrame } from '../src/dispatch.ts';
import { transcriptTurns, turnContents } from '../../../packages/client-ui/src/features/session/turns.ts';
import { transcriptToolResults } from '../../../packages/client-ui/src/features/session/tool-results.ts';

test('accepted steering journals an inline prompt inside the same turn and preserves tool results', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  const session = newId('s');
  createSession(db, { id: session, machine: 'm', project: '/repo', cwd: '/repo', vendor: 'fake', transport: 'cli' });
  const replies = [];
  const client = { device: 'desktop', subscriptions: new Set(), link: {
    reply: (_id, body) => replies.push(body), replyError: (_id, code, message) => replies.push({ code, message }),
  } };
  let accepted = true;
  const ctx = { db, notesDir: '/repo', resetUiCheckFollowups() {}, record: (session, kind, payload) => append(db, session, { kind, payload }),
    async toWorker(_session, method) { assert.equal(method, 'worker.steer'); return { type: accepted ? 'res' : 'err' }; },
  };
  ctx.record(session, 'turn_start', {});
  ctx.record(session, 'tool_call', { callId: 'call-1', name: 'Write', input: {} });
  const request = { v: 1, type: 'req', id: 'steer', method: 'session.steer', body: { session, text: 'steer while writing' } };
  await onClientFrame(ctx, client, request);
  assert.equal(replies.at(-1).accepted, true);
  ctx.record(session, 'tool_result', { callId: 'call-1', status: 'completed', output: 'write completed' });
  ctx.record(session, 'turn_end', {});
  const events = replay(db, session).map(e => ({ ...e, body: JSON.parse(e.payload) }));
  const parts = transcriptTurns(events);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].prompt, undefined);
  const { activity } = turnContents(parts[0].events, parts[0].prompt);
  assert.deepEqual(activity.map(e => e.kind), ['tool_call', 'prompt', 'tool_result']);
  assert.equal(activity[1].body.steer, true);
  assert.equal(transcriptToolResults(parts[0].events).get('call-1').body.status, 'completed');
  assert.equal(transcriptToolResults(parts[0].events).get('call-1').body.output, 'write completed');
  accepted = false;
  await onClientFrame(ctx, client, request);
  assert.equal(replies.at(-1).code, 'agent.unsupported');
  assert.equal(replay(db, session).filter(e => e.kind === 'prompt').length, 1);
});
