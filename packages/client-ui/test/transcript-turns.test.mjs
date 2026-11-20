import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

test('accepted prompt precedes one duration row, with grouped tools and changed files', async () => {
  const hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('/lib/platform.ts')) return { shortCircuit: true, format: 'module', source: 'export const usePlatform = () => ({ transport: { request: async () => ({ type: "res", body: {} }) } });' };
    if (url.endsWith('/TranscriptScroller.tsx')) return { shortCircuit: true, format: 'module', source: 'import { createElement } from "react"; export const TranscriptScroller = ({children}) => createElement("div", {"data-transcript": true}, children);' };
    if (url.endsWith('/Markdown.tsx')) return { shortCircuit: true, format: 'module', source: 'import { createElement } from "react"; export const Markdown = ({text}) => createElement("div", null, text);' };
    if (!url.endsWith('.tsx')) return next(url, context);
    return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
  } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const names = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    const { Transcript } = await import('../src/features/session/Transcript.tsx');
    const event = (seq, kind, body = {}) => ({ seq, kind, body, ts: seq * 1000 });
    const events = [event(1, 'turn_start'), event(2, 'prompt', { text: 'write a file' }),
      event(3, 'tool_call', { callId: 'call-1', name: 'Write', input: { file_path: '/a', content: 'hello' } }),
      event(4, 'tool_result', { callId: 'call-1', status: 'completed' }), event(5, 'text', { text: 'done' }), event(6, 'turn_end')];
    await act(() => root.render(createElement(Transcript, { events, session: 's', scratch: true })));
    const turn = document.querySelector('section[aria-label="Agent turn"]');
    assert.equal(document.querySelectorAll('section[aria-label="Agent turn"]').length, 1);
    assert.match(turn.firstElementChild.textContent, /Worked for 5s/);
    assert.ok(turn.previousElementSibling.textContent.includes('write a file'));
    assert.match(turn.textContent, /Changed 1 file/);
    assert.equal(turn.querySelector('[data-turn-activity]'), null);
    await act(() => turn.firstElementChild.click());
    assert.match(turn.querySelector('[data-turn-activity]').textContent, /Wrote a/);
    assert.match(turn.textContent, /done/);
    const stopped = [...events, event(7, 'turn_start'), event(8, 'prompt', { text: 'write again' }),
      event(9, 'tool_call', { callId: 'call-1', name: 'Write', input: { file_path: '/b', content: 'next' } }),
      event(10, 'tool_result', { callId: 'call-1', status: 'interrupted' }), event(11, 'interrupted', { reason: 'user_abort' })];
    await act(() => root.render(createElement(Transcript, { events: stopped, session: 's', scratch: true })));
    const turns = [...document.querySelectorAll('section[aria-label="Agent turn"]')];
    await act(() => turns[1].firstElementChild.click());
    assert.doesNotMatch(turns[0].querySelector('[data-turn-activity]').textContent, /Interrupted/i);
    assert.match(turns[1].querySelector('[data-turn-activity]').textContent, /Interrupted/i);
  } finally {
    await act(() => root.unmount());
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
    dom.window.close(); hook.deregister();
  }
});
