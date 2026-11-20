import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { allowBrowserGuest, hardenBrowserPreferences, installBrowserNavigation } from '../apps/desktop/src/main/browser-security.ts';

test('desktop guest attachment permits only HTTP(S) in a known isolated partition', () => {
  for (const url of ['https://example.com/', 'http://example.com/', 'http://abc-41000.localhost:5555/', 'http://127.0.0.1:3000/']) {
    assert.equal(allowBrowserGuest(url, 'persist:ormi-preview-abc123'), true);
    assert.equal(allowBrowserGuest(url, 'ormi-preview-abc123'), true);
    for (const partition of ['', 'persist:default', 'default', 'ormi-preview-../bad']) assert.equal(allowBrowserGuest(url, partition), false);
  }
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'about:blank', 'ftp://example.com', 'not a URL'])
    assert.equal(allowBrowserGuest(url, 'ormi-preview-abc123'), false);
});
test('untrusted guest attributes cannot enable Node, a preload, insecure content or nested webviews', () => {
  const preferences = { preload: '/app/preload.cjs', nodeIntegration: true, nodeIntegrationInWorker: true, nodeIntegrationInSubFrames: true,
    contextIsolation: false, sandbox: false, webSecurity: false, allowRunningInsecureContent: true, webviewTag: true, navigateOnDragDrop: true };
  hardenBrowserPreferences(preferences);
  assert.equal('preload' in preferences, false);
  for (const key of ['nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'allowRunningInsecureContent', 'webviewTag', 'navigateOnDragDrop']) assert.equal(preferences[key], false, key);
  for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(preferences[key], true, key);
});
test('normal navigation, redirects, frames and popup targets all block non-HTTP(S) schemes', async () => {
  const guest = new EventEmitter();
  const loaded = [];
  guest.setWindowOpenHandler = handler => { guest.popup = handler; };
  guest.loadURL = async url => { loaded.push(url); };
  installBrowserNavigation(guest);
  for (const type of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    for (const url of ['https://example.com/', 'http://localhost:41000/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'about:blank']) {
      let blocked = false;
      guest.emit(type, { url, preventDefault() { blocked = true; } }, url);
      assert.equal(blocked, !/^https?:/.test(url), `${type}: ${url}`);
    }
  }
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x']) assert.deepEqual(guest.popup({ url }), { action: 'deny' });
  assert.deepEqual(loaded, []);
  assert.deepEqual(guest.popup({ url: 'https://example.org/' }), { action: 'deny' });
  assert.deepEqual(loaded, ['https://example.org/']);
});
