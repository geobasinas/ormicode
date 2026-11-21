import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

test('duration leads live activity, updates every second, then collapses on finish or interrupt with final text visible', async t => {
  const hook = registerHooks({ load(url, context, next) {
    if (!url.endsWith('.tsx')) return next(url, context);
    return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
  } });
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    const { TurnActivity, turnDuration } = await import('../src/features/session/TurnActivity.tsx');
    const activity = createElement('div', { 'data-tools': true }, 'tool and thinking rows');
    const final = createElement('p', { 'data-final': true }, 'final answer');
    const render = (running, end, key = 'turn') => act(() => root.render(createElement(TurnActivity, { key, start: 1000, end, running, activity }, final)));
    await render(true, 1000);
    assert.equal(document.querySelector('button').textContent, 'Working for 0s');
    assert.ok(document.querySelector('[data-tools]'));
    assert.equal(document.querySelector('section').firstElementChild.tagName, 'BUTTON');
    await act(() => t.mock.timers.tick(12000));
    assert.equal(document.querySelector('button').textContent, 'Working for 12s');
    // A running turn can be collapsed and re-opened by hand.
    await act(() => document.querySelector('button').click());
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[data-tools]'), null);
    await act(() => document.querySelector('button').click());
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'true');
    assert.ok(document.querySelector('[data-tools]'));
    await render(false, 99000);
    const button = document.querySelector('button');
    assert.equal(button.textContent, 'Worked for 1m 38s');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.disabled, false);
    assert.equal(button.type, 'button', 'native buttons support Enter/Space activation');
    assert.equal(document.querySelector('[data-tools]'), null);
    assert.ok(document.querySelector('[data-final]'));
    await act(() => button.click());
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.ok(document.querySelector('[data-tools]'));
    await act(() => button.click());
    assert.equal(document.querySelector('[data-tools]'), null);
    await render(false, 5000, 'historical');
    assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'false');
    await render(true, 1000, 'interrupted');
    await render(false, 7000, 'interrupted');
    assert.equal(document.querySelector('[data-tools]'), null);
    assert.ok(document.querySelector('[data-final]'));
    assert.equal(turnDuration(1000, 0, false), 'Worked for 0s');
    await act(() => root.render(createElement(TurnActivity, { start: 0, end: 0, running: false, activity: null }, null)));
    assert.equal(document.querySelector('button').textContent, 'Worked for 0s');
  } finally {
    await act(() => root.unmount()); t.mock.timers.reset();
    Object.assign(globalThis, previous); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); hook.deregister();
  }
});
