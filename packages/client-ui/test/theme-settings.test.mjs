import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act, useEffect, useState } from 'react';
import { applyTheme, themeByName } from '../src/lib/theme.ts';

test('Appearance changes persist and apply the light palette, survive reload and switch back', async () => {
  const hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('/lib/platform.ts')) return { shortCircuit: true, format: 'module', source: 'export const usePlatform = () => ({ transport: { request: async () => ({ type: "res", body: { projects: [] } }) } });' };
    if (!url.endsWith('.tsx')) return next(url, context);
    return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
  } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const names = ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    const { SettingsView, loadPrefs, rememberProject } = await import('../src/routes/Settings.tsx');
    function Settings() {
      const [prefs, setPrefs] = useState(loadPrefs);
      useEffect(() => { applyTheme(themeByName(prefs.theme)); }, [prefs.theme]);
      return createElement(SettingsView, { prefs, onPrefs: setPrefs });
    }
    await act(async () => root.render(createElement(Settings)));
    const appearance = [...document.querySelectorAll('nav button')].find(button => button.textContent === 'Appearance');
    await act(async () => appearance.click());
    const switches = () => [...document.querySelectorAll('[role="switch"]')];
    await act(async () => switches()[1].click());
    assert.equal(loadPrefs().theme, 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(document.documentElement.style.getPropertyValue('--bg-window'), '#E7E7E7');
    rememberProject('/project'); assert.equal(loadPrefs().theme, 'light');
    await act(async () => root.render(createElement(Settings, { key: 'reload' })));
    assert.equal(document.documentElement.style.getPropertyValue('--bg-main'), '#F2F2F2');
    await act(async () => [...document.querySelectorAll('nav button')].find(button => button.textContent === 'Appearance').click());
    await act(async () => switches()[0].click());
    assert.equal(loadPrefs().theme, 'dark');
    assert.equal(document.documentElement.style.getPropertyValue('--bg-window'), '#101010');
    localStorage.setItem('ormi.prefs', '{broken'); assert.equal(loadPrefs().theme, 'dark');
    localStorage.removeItem('ormi.prefs'); assert.equal(loadPrefs().theme, 'dark');
  } finally {
    await act(async () => root.unmount());
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
    dom.window.close(); hook.deregister();
  }
});
