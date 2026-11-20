import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

test('prompts at either position stay above ticking live activity and completed changed files', async t => {
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
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  try {
    const { Transcript } = await import('../src/features/session/Transcript.tsx');
    const event = (seq, kind, body = {}) => ({ seq, kind, body, ts: seq * 1000 });
    for (const delayed of [false, true]) {
    const prompt = event(delayed ? 3 : 2, 'prompt', { text: 'write a file' });
    const tool = event(delayed ? 2 : 3, 'tool_call', { callId: 'call-1', name: 'Write', input: { file_path: '/a', content: 'hello' } });
    const events = [event(1, 'turn_start'), ...(delayed ? [tool, prompt] : [prompt, tool]),
      event(4, 'tool_result', { callId: 'call-1', status: 'completed', output: 'write completed' }), event(5, 'text', { text: 'done' }), event(6, 'turn_end')];
    await act(() => root.render(createElement(Transcript, { key: String(delayed), events, session: 's', scratch: true })));
    const turn = document.querySelector('section[aria-label="Agent turn"]');
    assert.equal(document.querySelectorAll('section[aria-label="Agent turn"]').length, 1);
    assert.match(turn.firstElementChild.textContent, /Worked for 5s/);
    assert.ok(turn.previousElementSibling.textContent.includes('write a file'));
    assert.match(turn.textContent, /Changed 1 file/);
    assert.equal(turn.querySelector('[data-turn-activity]'), null);
    await act(() => turn.firstElementChild.click());
    assert.match(turn.querySelector('[data-turn-activity]').textContent, /Wrote a/);
    const completed = turn.querySelector('[data-turn-activity] .ormi-tool');
    assert.equal(completed.querySelector('.animate-spin'), null);
    assert.doesNotMatch(completed.textContent, /failed|interrupted/i);
    await act(() => completed.querySelector('.ormi-tool-line').click());
    assert.match(completed.textContent, /write completed/);
    assert.match(turn.textContent, /done/);
    const stopped = [...events, event(7, 'turn_start'), event(8, 'prompt', { text: 'write again' }),
      event(9, 'tool_call', { callId: 'call-1', name: 'Write', input: { file_path: '/b', content: 'next' } }),
      event(10, 'tool_result', { callId: 'call-1', status: 'interrupted' }), event(11, 'interrupted', { reason: 'user_abort' })];
    await act(() => root.render(createElement(Transcript, { key: String(delayed), events: stopped, session: 's', scratch: true })));
    const turns = [...document.querySelectorAll('section[aria-label="Agent turn"]')];
    await act(() => turns[1].firstElementChild.click());
    assert.doesNotMatch(turns[0].querySelector('[data-turn-activity]').textContent, /Interrupted/i);
    assert.match(turns[1].querySelector('[data-turn-activity]').textContent, /Interrupted/i);
    }
    const steering = [event(1, 'turn_start'),
      event(2, 'tool_call', { callId: 'call-1', name: 'Write', input: { file_path: '/a', content: 'hello' } }),
      event(3, 'prompt', { text: 'steer while writing', steer: true }),
      event(4, 'tool_result', { callId: 'call-1', status: 'completed', output: 'steered write completed' }), event(5, 'turn_end')];
    await act(() => root.render(createElement(Transcript, { key: 'steer', events: steering, session: 's', scratch: true })));
    const steeredTurn = document.querySelector('section[aria-label="Agent turn"]');
    await act(() => steeredTurn.firstElementChild.click());
    const steeredActivity = steeredTurn.querySelector('[data-turn-activity]');
    const steeredTool = steeredActivity.children[0].querySelector('.ormi-tool');
    assert.ok(steeredTool);
    assert.match(steeredActivity.children[1].textContent, /steer while writing/);
    assert.equal(steeredTool.querySelector('.animate-spin'), null);
    await act(() => steeredTool.querySelector('.ormi-tool-line').click());
    assert.match(steeredTool.textContent, /steered write completed/);
    const live = [event(1, 'turn_start'), event(2, 'tool_call', { callId: 'live', name: 'Bash', input: { command: 'find /' } })];
    const renderLive = events => act(() => root.render(createElement(Transcript, { key: 'live', events, session: 's', scratch: true, busy: false })));
    await renderLive(live);
    const turn = document.querySelector('section[aria-label="Agent turn"]');
    const button = turn.firstElementChild;
    assert.equal(button.textContent, 'Working for 0s');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.match(turn.querySelector('[data-turn-activity]').textContent, /find \//);
    assert.ok(turn.querySelector('[data-turn-activity] .animate-spin'));
    await act(() => t.mock.timers.tick(12000));
    await renderLive([...live, event(3, 'prompt', { text: 'find files' })]);
    assert.equal(button.textContent, 'Working for 12s');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.ok(turn.previousElementSibling.textContent.includes('find files'));
    assert.match(turn.querySelector('[data-turn-activity]').textContent, /find \//);
    await act(() => t.mock.timers.tick(3000));
    assert.equal(button.textContent, 'Working for 15s');
    await renderLive([...live, event(3, 'prompt', { text: 'find files' }), { ...event(4, 'interrupted', { reason: 'user_abort' }), ts: 16000 }]);
    assert.equal(button.textContent, 'Worked for 15s');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(turn.querySelector('[data-turn-activity]'), null);
  } finally {
    await act(() => root.unmount());
    t.mock.timers.reset();
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
    dom.window.close(); hook.deregister();
  }
});
