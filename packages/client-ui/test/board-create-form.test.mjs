import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

test('board form needs only a name and submits while an unrelated board list is loading', async () => {
  const hook = registerHooks({ load(url, context, next) {
    if (!url.endsWith('.tsx')) return next(url, context);
    return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
  } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    const { DesignBoardHeader } = await import('../src/features/design/DesignBoardHeader.tsx');
    let submitted = 0;
    const noop = () => {};
    const props = { boards: [], slug: '', status: '', failure: false, error: '', canReload: false, loading: true, saving: false, sourceDirty: false, inspectorOpen: false, createOpen: true, creating: false, newName: 'Testing', insertFrame: null, readBoard: noop, reloadCurrent: noop, toggleInspector: noop, createBoard: () => submitted++, setCreateOpen: noop, setError: noop, setNewName: noop };
    await act(() => root.render(createElement(DesignBoardHeader, props)));
    assert.equal(document.querySelectorAll('form input').length, 1);
    const submit = document.querySelector('button[type="submit"]');
    assert.equal(submit.disabled, false);
    await act(() => submit.click());
    await act(() => document.querySelector('form').requestSubmit());
    assert.equal(submitted, 2);
    await act(() => root.render(createElement(DesignBoardHeader, { ...props, newName: '' })));
    assert.equal(document.querySelector('button[type="submit"]').disabled, true);
    await act(() => root.render(createElement(DesignBoardHeader, { ...props, creating: true })));
    assert.equal(document.querySelector('button[type="submit"]').disabled, true);
  } finally {
    await act(() => root.unmount());
    globalThis.window = oldWindow; globalThis.document = oldDocument;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close(); hook.deregister();
  }
});
