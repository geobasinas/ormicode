import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSdkAdapter } from '@ormicode/agent-claude-sdk';
import { openStore, createSession, createTeam, setSessionTeam, getSession, setState, hasPendingApproval, unreadTeamMessages } from '@ormicode/session-store';
import { append, replay } from '@ormicode/journal';
import { createPromptDelivery } from '../src/prompt-delivery.ts';
import { TeamApprovals } from '../src/team-approvals.ts';
import { teamMethod } from '../src/team-methods.ts';
import { stateFor } from '../src/supervisor-state.ts';

test('urgent team delivery clears a real Claude SDK user approval before waking the child', async t => {
  const db = openStore(':memory:'); t.after(() => db.close());
  for (const id of ['parent', 'child']) createSession(db, { id, machine: 'm', project: '/repo', cwd: '/repo', vendor: 'claude', transport: 'sdk', ...(id === 'child' ? { parent: 'parent' } : {}) });
  createTeam(db, { id: 'team', parent: 'parent', project: '/repo' }); setSessionTeam(db, 'child', 'team');
  let turns = 0;
  const adapter = new ClaudeSdkAdapter({ query: ({ options }) => (async function* () {
    yield { type: 'system', subtype: 'init', claude_code_version: 'test', session_id: 'native-1' };
    if (++turns === 1) await options.canUseTool('Bash', { command: 'rm -rf /repo/important' }, { signal: new AbortController().signal });
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
  })() });
  const handle = await adapter.start({ cwd: '/repo' }); t.after(() => adapter.dispose(handle));
  const stream = adapter.events(handle)[Symbol.asyncIterator]();
  const ctx = { db, teamLifecycle: { preserveHandoffs: (_id, fn) => fn() },
    record(session, kind, payload) {
      [kind, payload] = ctx.teamApprovals.event(session, kind, payload);
      append(db, session, { kind, payload });
      const state = kind === 'state' ? payload.state : stateFor[kind];
      if (state) setState(db, session, state);
    },
  };
  ctx.teamApprovals = new TeamApprovals(() => ctx, () => false);
  const until = async kind => {
    let event;
    do { event = (await stream.next()).value; ctx.record('child', event.kind, event); } while (event.kind !== kind);
    return event;
  };
  const sent = [];
  Object.assign(ctx, createPromptDelivery({ db, paused: new Set(), heldPrompts: new Map(), lastPrompt: new Map(), record: ctx.record, ensureWorker: async () => {},
    toWorker: async (_session, method, body) => {
      assert.equal(method, 'worker.prompt'); sent.push(body.text);
      await adapter.prompt(handle, body); await until('turn_start'); return { type: 'res' };
    },
  }));
  ctx.toWorker = async (_session, method) => {
    assert.equal(method, 'worker.abort'); await adapter.interrupt(handle); await until('interrupted'); return { type: 'res' };
  };
  await adapter.prompt(handle, { text: 'initial' });
  const approval = await until('approval_request');
  assert.equal(getSession(db, 'child').state, 'awaiting_approval'); assert.equal(hasPendingApproval(db, 'child'), true);
  const replies = [], errors = [];
  await teamMethod(ctx, { link: { reply: (_id, body) => replies.push(body), replyError: (...args) => errors.push(args) } }, 'message', 'team.message', { actor: 'parent', to: 'child', text: 'urgent update', urgent: true });
  assert.deepEqual(errors, []); assert.equal(replies.length, 1);
  assert.equal(hasPendingApproval(db, 'child'), false);
  assert.equal(replay(db, 'child').filter(e => e.kind === 'interaction_expired' && JSON.parse(e.payload).request === approval.request).length, 1);
  assert.equal(sent.length, 1); assert.match(sent[0], /urgent update/);
  assert.deepEqual(unreadTeamMessages(db, 'child'), []);
  await assert.rejects(adapter.approve(handle, approval.request, 'allow'), /no longer pending/);
  await until('turn_end'); assert.equal(getSession(db, 'child').state, 'idle');
});
