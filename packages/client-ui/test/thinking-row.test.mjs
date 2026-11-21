import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

test('thinking with text opens by default in readable text and still collapses on click', async () => {
  const hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('/lib/platform.ts')) return { shortCircuit: true, format: 'module', source: 'export const usePlatform = () => ({ transport: { request: async () => ({ type: "res", body: {} }) } });' };
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
    const { ThinkingRow } = await import('../src/features/session/ToolRow.tsx');
    const toggle = () => document.querySelector('button[aria-expanded]');
    const body = () => document.querySelector('.ormi-markdown');

    await act(() => root.render(createElement(ThinkingRow, { text: 'List the folder before writing the file.' })));
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.match(body().textContent, /List the folder before writing the file\./);
    assert.equal(body().style.color, 'var(--text-label)');

    await act(() => toggle().click());
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    assert.equal(body(), null);
    await act(() => toggle().click());
    assert.match(body().textContent, /List the folder/);
    await act(() => root.render(null));

    // No thinking text yet: stay collapsed, then open once streamed text arrives.
    await act(() => root.render(createElement(ThinkingRow, { text: '' })));
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    assert.equal(body(), null);
    await act(() => root.render(createElement(ThinkingRow, { text: 'Streaming thought' })));
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.match(body().textContent, /Streaming thought/);
    await act(() => root.render(null));

    // The placeholder for missing text keeps the muted style.
    await act(() => root.render(createElement(ThinkingRow, { text: '  ' })));
    await act(() => toggle().click());
    assert.match(body().textContent, /not provided/);
    assert.equal(body().style.color, 'var(--text-hint)');
    await act(() => root.render(null));

    // Inside collapsed turn activity, thinking with text starts folded but still opens on click.
    await act(() => root.render(createElement(ThinkingRow, { text: 'Folded thought', openByDefault: false })));
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    assert.equal(body(), null);
    await act(() => toggle().click());
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.match(body().textContent, /Folded thought/);
  } finally {
    await act(() => root.unmount());
    for (const name of names) previous[name] ? Object.defineProperty(globalThis, name, previous[name]) : delete globalThis[name];
    dom.window.close(); hook.deregister();
  }
});
