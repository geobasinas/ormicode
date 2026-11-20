import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act, useState } from 'react';
import { cssVars } from '@ormicode/ui-tokens';
import { themeByName } from '../src/lib/theme.ts';

function themeBlock(css, name) {
  const start = css.indexOf(`/* ormi-theme-${name} */`);
  const end = css.indexOf(name === 'dark' ? '/* ormi-theme-light */' : '/* ormi-theme-end */', start);
  assert.ok(start >= 0 && end > start, `missing ${name} theme block`);
  return css.slice(start, end);
}

test('theme CSS follows the root class and data-theme, not prefers-color-scheme', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /@custom-variant dark \(&:where\(\.dark, \.dark \*\)\)/);
  assert.equal(css.includes('prefers-color-scheme'), false);
  for (const name of ['dark', 'light']) {
    const block = themeBlock(css, name);
    assert.match(block, new RegExp(`:root\\[data-theme="${name}"\\]`));
    assert.match(block, new RegExp(`:root\\.${name}`));
    assert.match(block, new RegExp(`color-scheme:\\s*only ${name}`));
    for (const [token, value] of Object.entries(themeByName(name).colors)) {
      const variable = `--${token.replaceAll('.', '-')}`;
      assert.match(block, new RegExp(`${variable}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`));
      assert.equal(cssVars(themeByName(name))[variable], value);
    }
  }
  const light = themeBlock(css, 'light');
  const dark = themeBlock(css, 'dark');
  assert.match(light, /--bg-window:\s*#E7E7E7;/);
  assert.doesNotMatch(light, /--bg-window:\s*#101010;/);
  assert.match(dark, /--bg-window:\s*#101010;/);
});

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
      return createElement(SettingsView, { prefs, onPrefs: setPrefs });
    }
    await act(async () => root.render(createElement(Settings)));
    const appearance = [...document.querySelectorAll('nav button')].find(button => button.textContent === 'Appearance');
    await act(async () => appearance.click());
    const switches = () => [...document.querySelectorAll('[role="switch"]')];
    await act(async () => switches()[1].click());
    const html = document.documentElement;
    assert.equal(switches()[1].getAttribute('aria-checked'), 'true');
    assert.equal(switches()[0].getAttribute('aria-checked'), 'false');
    assert.equal(JSON.parse(localStorage.getItem('ormi.prefs')).theme, 'light');
    assert.equal(loadPrefs().theme, 'light');
    assert.equal(html.dataset.theme, 'light');
    assert.equal(html.classList.contains('light'), true);
    assert.equal(html.classList.contains('dark'), false);
    assert.equal(html.style.colorScheme, 'only light');
    assert.equal(html.style.getPropertyValue('--bg-window'), '#E7E7E7');
    assert.notEqual(html.style.getPropertyValue('--bg-window'), '#101010');
    assert.equal(html.style.getPropertyValue('--text-title'), '#1B1B1B');
    rememberProject('/project'); assert.equal(loadPrefs().theme, 'light');
    await act(async () => root.render(createElement(Settings, { key: 'reload' })));
    assert.equal(document.documentElement.style.getPropertyValue('--bg-main'), '#F2F2F2');
    await act(async () => [...document.querySelectorAll('nav button')].find(button => button.textContent === 'Appearance').click());
    await act(async () => switches()[0].click());
    assert.equal(switches()[0].getAttribute('aria-checked'), 'true');
    assert.equal(switches()[1].getAttribute('aria-checked'), 'false');
    assert.equal(JSON.parse(localStorage.getItem('ormi.prefs')).theme, 'dark');
    assert.equal(loadPrefs().theme, 'dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(document.documentElement.classList.contains('dark'), true);
    assert.equal(document.documentElement.classList.contains('light'), false);
    assert.equal(document.documentElement.style.colorScheme, 'only dark');
    assert.equal(document.documentElement.style.getPropertyValue('--bg-window'), '#101010');
    localStorage.setItem('ormi.prefs', '{broken'); assert.equal(loadPrefs().theme, 'dark');
    localStorage.removeItem('ormi.prefs'); assert.equal(loadPrefs().theme, 'dark');
  } finally {
    await act(async () => root.unmount());
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
    dom.window.close(); hook.deregister();
  }
});
