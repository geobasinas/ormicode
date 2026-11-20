import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';

registerHooks({ load(url, context, next) {
  if (url.endsWith('/lib/platform.ts')) return { shortCircuit: true, format: 'module', source: 'export const usePlatform = () => globalThis.__ormiPlatform;' };
  if (!url.endsWith('.tsx')) return next(url, context);
  return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
} });

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { SettingsView, loadPrefs } = await import('../src/routes/Settings.tsx');

const chunks = [Buffer.from('tar-part-1|'), Buffer.from('tar-part-2')];
function platform(web) {
  const requests = [];
  const reply = body => ({ v: 1, type: 'res', id: 'r', ts: 0, body });
  return {
    requests,
    ...(web ? { web: { version: '1', commit: 'c', relayUrl: 'wss://relay' } } : {}),
    transport: { async request(method, body) {
      requests.push([method, body]);
      if (method === 'data.export') return reply({ handle: 'h1', size: 21, name: 'ormicode-export-20261121-120000.tar', files: ['store.db'] });
      if (method === 'data.exportChunk') { const index = body.offset === 0 ? 0 : 1; return reply({ data: chunks[index].toString('base64'), done: index === 1 }); }
      if (method === 'data.wipe') return reply({ wiped: true, removed: ['store.db', 'logs', 'hub.json'], kept: [] });
      return reply({});
    } },
  };
}

async function openPrivacy(web = false) {
  const p = platform(web);
  globalThis.__ormiPlatform = p;
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(SettingsView, { prefs: loadPrefs(), onPrefs: () => undefined })));
  await act(async () => [...document.querySelectorAll('nav button')].find(b => b.textContent === 'Data and privacy').click());
  return { p, root };
}
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
const typeInto = async (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});

test('Export pulls every chunk and downloads one tar file', async () => {
  const { p, root } = await openPrivacy();
  assert.match(document.body.textContent, /~\/\.ormicode\/ on this machine/, 'storage note stays');
  const downloads = [];
  const created = [];
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = blob => { created.push(blob); return 'blob:test'; };
  URL.revokeObjectURL = () => undefined;
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, name: this.download }); };
  try {
    await act(async () => button('Export').click());
    assert.deepEqual(p.requests.map(([method, body]) => [method, body]), [
      ['data.export', {}], ['data.exportChunk', { handle: 'h1', offset: 0 }], ['data.exportChunk', { handle: 'h1', offset: 11 }],
    ]);
    assert.deepEqual(downloads, [{ href: 'blob:test', name: 'ormicode-export-20261121-120000.tar' }]);
    assert.equal(Buffer.from(await created[0].arrayBuffer()).toString(), 'tar-part-1|tar-part-2');
    assert.match(document.querySelector('[role="status"]').textContent, /Saved ormicode-export/);
  } finally { URL.createObjectURL = realCreate; await act(async () => root.unmount()); }
});

test('Delete needs the typed word before the irreversible button works', async () => {
  const { p, root } = await openPrivacy();
  try {
    await act(async () => button('Delete…').click());
    const input = document.querySelector('input[aria-label="Type wipe to confirm"]');
    const confirm = () => button('Delete everything permanently');
    assert.ok(input && confirm().disabled, 'starts disabled');
    for (const word of ['', 'wip', 'WIPE', 'yes', 'wipe it']) {
      await typeInto(input, word);
      assert.equal(confirm().disabled, true, `"${word}" must not enable delete`);
      await act(async () => confirm().click());
    }
    assert.deepEqual(p.requests.filter(([method]) => method === 'data.wipe'), [], 'no wipe request without the word');
    await act(async () => button('Cancel').click());
    assert.equal(document.querySelector('input[aria-label="Type wipe to confirm"]'), null, 'cancel closes the prompt');
    await act(async () => button('Delete…').click());
    assert.equal(document.querySelector('input[aria-label="Type wipe to confirm"]').value, '', 'reopening starts empty');
    await typeInto(document.querySelector('input[aria-label="Type wipe to confirm"]'), 'wipe');
    assert.equal(confirm().disabled, false);
    await act(async () => confirm().click());
    assert.deepEqual(p.requests.filter(([method]) => method === 'data.wipe'), [['data.wipe', { confirm: 'wipe' }]]);
    assert.match(document.body.textContent, /Local data deleted/);
    assert.match(document.body.textContent, /Removed store\.db, logs, hub\.json/);
    assert.match(document.body.textContent, /hub has stopped/);
    assert.equal(button('Export'), undefined, 'no actions left on a wiped hub');
  } finally { await act(async () => root.unmount()); }
});

test('Delete shows the hub’s refusal and keeps the prompt open', async () => {
  const { p, root } = await openPrivacy();
  p.transport.request = async (method, body) => { p.requests.push([method, body]); return { v: 1, type: 'err', id: 'r', ts: 0, code: 'data.local_only', message: 'Export and delete only work on the hub’s own computer.' }; };
  try {
    await act(async () => button('Delete…').click());
    await typeInto(document.querySelector('input[aria-label="Type wipe to confirm"]'), 'wipe');
    await act(async () => button('Delete everything permanently').click());
    assert.match(document.querySelector('[role="alert"]').textContent, /data\.local_only/);
    assert.doesNotMatch(document.body.textContent, /Local data deleted/);
  } finally { await act(async () => root.unmount()); }
});

test('the web app cannot export or delete the hub’s data', async () => {
  const { root } = await openPrivacy(true);
  try {
    assert.match(document.body.textContent, /Only on the hub’s own computer/);
    assert.equal(button('Export').disabled, true);
    assert.equal(button('Delete…').disabled, true);
  } finally { await act(async () => root.unmount()); }
});
