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

test('the files-rail comment box sends to the viewed interrupted session and opens no new one', async () => {
  const { registerHooks } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { transformSync } = await import('esbuild');
  const { JSDOM } = await import('jsdom');
  const { createElement, act } = await import('react');
  const stubs = {
    '/lib/platform.ts': 'export const usePlatform = () => globalThis.__askTest.platform;',
    '/files/editor.ts': "export const languageName = () => 'text';",
  };
  const hook = registerHooks({ load(url, context, next) {
    const stub = Object.entries(stubs).find(([suffix]) => url.endsWith(suffix))?.[1];
    if (stub) return { shortCircuit: true, format: 'module', source: stub };
    if (!url.endsWith('.tsx')) return next(url, context);
    return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
  } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const names = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', '__askTest'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [], opened = [];
  globalThis.__askTest = { platform: { transport: { async request(method, body) {
    calls.push({ method, body });
    if (method === 'session.get') return ok({ id: 's_scratch', title: null, state: 'interrupted', project: 'scratch', vendor: 'claude', transport: 'sdk', updatedAt: 1 });
    return ok({ accepted: true });
  } } } };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    const { AskBox } = await import('../src/features/files/AskBox.tsx');
    await act(async () => root.render(createElement(AskBox, {
      session: 's_scratch', path: 'cool things.txt', sel: { from: 1, to: 1, text: 'est file.\n' }, onClose() {}, onStarted: id => opened.push(id),
    })));
    const area = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(area, 'change this to testing file');
    await act(async () => area.dispatchEvent(new dom.window.Event('input', { bubbles: true })));
    await act(async () => document.querySelector('[aria-label="send comment"]').click());
    assert.equal(calls.some(call => call.method === 'session.start'), false);
    assert.deepEqual(calls.filter(call => call.method !== 'session.get'), [{ method: 'session.prompt', body: {
      session: 's_scratch', text: 'About `cool things.txt` line 1:\n\n```text\nest file.\n```\n\nchange this to testing file',
    } }]);
    assert.deepEqual(opened, ['s_scratch']);
  } finally {
    await act(() => root.unmount());
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
    dom.window.close(); hook.deregister();
  }
});
