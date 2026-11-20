import test from 'node:test';
import assert from 'node:assert/strict';
import { sendFileComment } from '../src/features/files/send-file-comment.ts';

const defaults = { project: '/repo', vendor: 'claude', transport: 'sdk', model: 'sonnet', effort: 'high', mode: 'default' };
const prompt = 'About `file.ts` line 8:\n\n```typescript\nconst x = 1;\n```\n\nPlease explain this';
const ok = body => ({ type: 'res', body });

test('a file-line comment targets the viewed session without creating a session', async () => {
  const calls = [];
  const transport = { async request(method, body) { calls.push({ method, body }); return ok({ accepted: true }); } };
  assert.equal(await sendFileComment(transport, defaults, prompt, 's_active'), 's_active');
  assert.deepEqual(calls, [{ method: 'session.prompt', body: { session: 's_active', text: prompt } }]);
});
test('without an active session a new session is created in the same project before sending', async () => {
  for (const project of ['/repo', 'scratch']) {
    const calls = [];
    const transport = { async request(method, body) { calls.push({ method, body }); return ok(method === 'session.start' ? { session: 's_new' } : { accepted: true }); } };
    assert.equal(await sendFileComment(transport, { ...defaults, project }, prompt), 's_new');
    assert.equal(calls[0].method, 'session.start');
    assert.equal(calls[0].body.project, project);
    assert.equal(calls[0].body.vendor, 'claude');
    assert.equal(calls[0].body.model, 'sonnet');
    assert.equal(calls[0].body.workspace.kind, project === 'scratch' ? 'scratch' : 'current');
    assert.deepEqual(calls[1], { method: 'session.prompt', body: { session: 's_new', text: prompt } });
  }
});
test('a busy active session queues the comment in that same session', async () => {
  const calls = [];
  const transport = { async request(method, body) {
    calls.push({ method, body });
    return method === 'session.prompt' ? { type: 'err', code: 'session.busy', message: 'turn in progress' } : ok({ queued: true });
  } };
  assert.equal(await sendFileComment(transport, defaults, prompt, 's_busy'), 's_busy');
  assert.deepEqual(calls, ['session.prompt', 'session.queue.add'].map(method => ({ method, body: { session: 's_busy', text: prompt } })));
});
test('empty comments make no requests and start, prompt, queue and network errors are surfaced', async () => {
  await assert.rejects(sendFileComment({ request() { assert.fail(); } }, defaults, '  ', 's'), /Enter a comment/);
  for (const failing of ['session.start', 'session.prompt', 'session.queue.add']) {
    const calls = [];
    const transport = { async request(method) {
      calls.push(method);
      if (method === failing) return { type: 'err', code: 'agent.failed', message: 'test failure' };
      return method === 'session.prompt' ? { type: 'err', code: 'session.busy' } : ok({ session: 's_new' });
    } };
    await assert.rejects(sendFileComment(transport, defaults, prompt, failing === 'session.start' ? undefined : 's'), /test failure/);
    assert.equal(calls.at(-1), failing);
  }
  await assert.rejects(sendFileComment({ async request() { throw new Error('offline'); } }, defaults, prompt, 's'), /offline/);
});
