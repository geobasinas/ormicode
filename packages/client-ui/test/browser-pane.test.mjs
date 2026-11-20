import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

test('Browser pane opens the web without a service and wires navigation without remounting; local portals still work', async () => {
  const stubs = {
    '/lib/platform.ts': 'export const usePlatform = () => globalThis.__browserTest.platform;',
    '/useSession.ts': "export const useSession = () => ({ project: '/test-project' });",
    '/BrowserControls.tsx': 'export const BrowserControls = props => { globalThis.__browserTest.controls = props; return null; };',
    '/BrowserNotice.tsx': 'export const ChoosePreview = () => null, EmptyPreview = () => null, RemotePreview = () => null, StoppedPreview = () => null;',
    '/BrowserLogDrawer.tsx': 'export const BrowserLogDrawer = () => null;',
    '/BrowserAnnotator.tsx': 'export const BrowserAnnotator = () => null;',
    '/useBrowserInspector.ts': 'export const annotationStorageKey = () => "test"; export const useBrowserInspector = () => ({ pick() {}, annotate() {}, setFrame() {} });',
    '/usePreviewConsole.ts': 'export const usePreviewConsole = () => ({ setOpen() {} });',
    '/ui/tooltip.tsx': 'export const TooltipProvider = props => props.children;',
  };
  const hook = registerHooks({ load(url, context, next) {
    const stub = Object.entries(stubs).find(([suffix]) => url.endsWith(suffix))?.[1];
    if (stub) return { shortCircuit: true, format: 'module', source: stub };
    if (!url.endsWith('.tsx')) return next(url, context);
    return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
  } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const names = ['window', 'document', 'localStorage', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT', '__browserTest'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [], loaded = [], navigations = [];
  const prototype = dom.window.HTMLElement.prototype;
  prototype.loadURL = async function (url) { loaded.push(url); this.dispatchEvent(Object.assign(new dom.window.Event('did-navigate'), { url })); };
  prototype.canGoBack = () => true; prototype.canGoForward = () => false;
  prototype.goBack = () => navigations.push('back'); prototype.goForward = () => navigations.push('forward'); prototype.reload = () => navigations.push('reload');
  globalThis.__browserTest = { platform: { kind: 'desktop', desktop: { remote: () => null }, transport: {
    request: async (method, body) => {
      calls.push({ method, body });
      if (method === 'service.list') return { type: 'res', body: { services: [], detected: [], ports: { base: 41000, count: 10 } } };
      if (method === 'preview.url') return { type: 'res', body: { url: `http://s-${body.port}.localhost:5555${body.path}` } };
      throw new Error(`Unexpected ${method}`);
    },
  } } };
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  try {
    const { BrowserPane } = await import('../src/features/browser/BrowserPane.tsx');
    await act(async () => root.render(createElement(BrowserPane, { session: 'test-session' })));
    const controls = () => globalThis.__browserTest.controls;
    assert.equal(controls().current, undefined);
    await act(async () => controls().onAddressChange('example.com'));
    await act(async () => controls().onAddressSubmit());
    const first = document.querySelector('webview');
    assert.ok(first); assert.equal(first.getAttribute('src'), 'https://example.com/');
    assert.equal(calls.filter(call => call.method === 'preview.url').length, 0);
    await act(async () => controls().onAddressChange('https://example.org/docs'));
    await act(async () => controls().onAddressSubmit());
    assert.deepEqual(loaded, ['https://example.org/docs']);
    assert.equal(document.querySelector('webview'), first, 'navigation must not destroy native back/forward history');
    assert.equal(controls().address, 'https://example.org/docs');
    assert.equal(controls().canBack, true);
    controls().onBack(); controls().onForward(); controls().onReload();
    assert.deepEqual(navigations, ['back', 'forward', 'reload']);
    await act(async () => controls().onAddressChange('javascript:alert(1)'));
    await act(async () => controls().onAddressSubmit());
    assert.equal(loaded.length, 1); assert.match(document.querySelector('[role="alert"]').textContent, /Only HTTP/);
    await act(async () => controls().onOpenPortal(41000, '/admin', 'App'));
    assert.equal(controls().current.port, 41000);
    assert.equal(document.querySelector('webview').getAttribute('src'), 'http://s-41000.localhost:5555/admin');
    assert.ok(calls.some(call => call.method === 'preview.url' && call.body.port === 41000));
    await act(async () => controls().onAddressChange('/next'));
    await act(async () => controls().onAddressSubmit());
    assert.equal(loaded.at(-1), 'http://s-41000.localhost:5555/next');
    assert.equal(controls().current.port, 41000);
  } finally {
    await act(() => root.unmount());
    for (const name of names) { if (previous[name]) Object.defineProperty(globalThis, name, previous[name]); else delete globalThis[name]; }
    dom.window.close(); hook.deregister();
  }
});
