import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { needsUser } from '../src/features/session/team-tree.ts';
import { groupProjects } from '../src/features/projects/groupProjects.ts';
import { USER_WAIT_STATES } from '../src/features/session/waiting.ts';
import { pendingInteractions } from '../src/features/session/pending-interactions.ts';

test('sidebar waiting counts and project ordering include only pending user questions and approvals', () => {
  const rows = ['interrupted', 'failed', 'idle', 'paused_rate_limited', 'awaiting_approval', 'awaiting_input', 'running'].map((state, i) => ({ id: `${i}`, project: '/repo', state, updatedAt: 100 - i }));
  assert.deepEqual(rows.filter(needsUser).map(s => s.state), ['awaiting_approval', 'awaiting_input']);
  assert.equal(rows.filter(needsUser).length, 2);
  assert.equal([].filter(needsUser).length, 0);
  assert.equal(needsUser({ ...rows[4], delegatedApproval: true }), false);
  assert.deepEqual(groupProjects(rows, [])[0].sessions.slice(0, 3).map(s => s.state), ['awaiting_approval', 'awaiting_input', 'running']);
  assert.deepEqual([...USER_WAIT_STATES], ['awaiting_approval', 'awaiting_input']);
});

test('user abort clears historical pending interactions, without removing answerable questions on other interruptions', () => {
  const pending = [{ kind: 'approval_request', body: { request: 'a' } }, { kind: 'question_request', body: { request: 'q' } }];
  assert.deepEqual(pendingInteractions(pending, { kind: 'interrupted', body: { reason: 'user_abort' } }), []);
  assert.deepEqual(pendingInteractions(pending, { kind: 'interrupted', body: { reason: 'host_restart' } }), pending);
  assert.deepEqual(pendingInteractions([], { kind: 'interrupted', body: { reason: 'user_abort' } }), []);
});

test('stopped glyphs are muted, failures stay red and only pending interactions share Needs You states', async () => {
  const hook = registerHooks({ load(url, context, next) {
    if (!url.endsWith('.tsx')) return next(url, context);
    return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
  } });
  try {
    const { NEEDS_YOU, glyphFor, stateLabel, StateIcon } = await import('../src/features/session/state.tsx');
    assert.equal(NEEDS_YOU, USER_WAIT_STATES);
    assert.equal(glyphFor('interrupted').color, 'var(--text-hint)');
    assert.equal(stateLabel('interrupted'), 'stopped');
    const stopped = renderToStaticMarkup(createElement(StateIcon, { state: 'interrupted' }));
    assert.match(stopped, /aria-label="stopped"/);
    assert.doesNotMatch(stopped, /lucide-hand|accent-amber/);
    assert.equal(glyphFor('failed').color, 'var(--accent-red)');
    assert.match(renderToStaticMarkup(createElement(StateIcon, { state: 'failed' })), /aria-label="failed"/);
  } finally { hook.deregister(); }
});
