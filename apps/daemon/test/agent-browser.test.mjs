import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { AgentBrowser, BrowserError, discoverBrowser } from '../src/agent-browser.ts';
import { destination } from '../src/browser-methods.ts';
import { PreviewProxy, previewLabel } from '../src/preview-proxy.ts';
import { createPromptDelivery } from '../src/prompt-delivery.ts';
import { recordUiCheckResult, UiCheckFollowupGuard } from '../src/ui-check.ts';
import { newId } from '@ormicode/protocol';
import { addQueuedPrompt, createSession, listQueuedPrompts, openStore } from '@ormicode/session-store';

test('browser discovery honors env, managed shell, then system path', () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-browser-discovery-'));
  try {
    const envPath = join(root, 'env-browser');
    const managed = join(root, 'browsers', 'chromium-headless-shell-1', 'chrome-linux', 'headless_shell');
    const systemDir = join(root, 'bin');
    const systemPath = join(systemDir, 'google-chrome');
    for (const path of [envPath, managed, systemPath]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '#!/bin/sh\nexit 0\n');
      chmodSync(path, 0o755);
    }
    assert.deepEqual(discoverBrowser({ ORMICODE_BROWSER: envPath, PATH: systemDir }, root, 'linux'), { available: true, source: 'env', path: envPath });
    assert.deepEqual(discoverBrowser({ PATH: systemDir }, root, 'linux'), { available: true, source: 'installed', path: managed });
    rmSync(managed);
    assert.deepEqual(discoverBrowser({ PATH: systemDir }, root, 'linux'), { available: true, source: 'system', path: systemPath });
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); }
});

test('browser navigation accepts only session-local preview origins and port block', () => {
  const session = newId('s');
  const listed = {
    ports: { base: 41000, count: 10 }, proxy: { port: 41999 },
    services: [{ state: 'running', port: 41001, portals: [{ path: '/' }] }], detected: [{ port: 41002 }],
  };
  assert.deepEqual(destination(session, { url: 'http://localhost:41001/a' }, listed), { port: 41001, path: '/a' });
  assert.deepEqual(destination(session, { url: '127.0.0.1:41002/b' }, listed), { port: 41002, path: '/b' });
  assert.deepEqual(destination(session, {}, listed), { port: 41001, path: '/' });
  assert.deepEqual(destination(session, { url: `http://${previewLabel(session, 41001)}.localhost:41999/preview` }, listed), { port: 41001, path: '/preview' });
  assert.throws(() => destination(session, { url: 'https://example.com' }, listed), BrowserError);
  assert.throws(() => destination(session, { url: 'http://localhost:3000' }, listed), BrowserError);
  assert.throws(() => destination(session, { port: 48999 }, listed), BrowserError);
});

test('browser artifacts validate ids and enforce the 4 MiB cap', () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-browser-artifact-'));
  const session = newId('s');
  const id = newId('bl');
  try {
    const directory = join(root, 'sessions', session, 'browser');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${id}.png`), Buffer.from('png'));
    const browser = new AgentBrowser(root, {});
    assert.equal(Buffer.from(browser.artifact(session, id).data, 'base64').toString(), 'png');
    assert.throws(() => browser.artifact(session, `${id}/../../store.db`), error => error.code === 'browser.not_found');
    writeFileSync(join(directory, `${id}.png`), Buffer.alloc(4 * 1024 * 1024 + 1));
    assert.throws(() => browser.artifact(session, id), error => error.code === 'browser.action_failed');
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); }
});

test('checkpoint capture does nothing when there is no running service', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-browser-no-service-'));
  const browser = new AgentBrowser(root, { list: async () => ({ services: [] }) });
  const events = [];
  try {
    await browser.captureCheckpoint(newId('s'), 'checkpoint', [], Date.now(), 0, (_session, kind) => events.push(kind));
    assert.deepEqual(events, []);
  } finally {
    await browser.closeAll();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});

test('headless browser drives preview proxy and blocks external main-frame navigation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ormi-browser-e2e-'));
  let servicePort = 0;
  let proxyPort = 0;
  const session = newId('s');
  const services = {
    list: async () => ({
      ports: { base: servicePort, count: 10 }, proxy: { port: proxyPort },
      services: [{ state: 'running', port: servicePort, portals: [{ path: '/' }] }], detected: [],
    }),
    previewUrl: async (_session, port, path) => proxy.url(session, port, port, path),
    previewConsole: (_session, after) => proxy.console(session, after),
  };
  const browser = new AgentBrowser(root, services);
  const previousBrowserPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const found = browser.status();
  if (!found.available) { await browser.closeAll(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200}); t.skip('No browser found; install with `ormi browser install` or set ORMICODE_BROWSER.'); return; }
  let server;
  const proxy = new PreviewProxy();
  let db;
  try {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><button id="err" onclick="console.error(new Error(\'fixture error\'))">Error</button><button id="save" onclick="document.body.dataset.clicked=\'yes\'">Save</button><input id="name"><a id="external" href="https://example.com">external</a><main>fixture</main>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    servicePort = port;
    await proxy.listen();
    proxyPort = proxy.port;
    const base = port;
    const url = proxy.url(session, base, port, '/');
    const origin = proxy.origin(session, port);
    await browser.open(session, url, [origin]);
    assert.match((await browser.snapshot(session)).snapshot, /Save/);
    await browser.click(session, '#save');
    await browser.type(session, '#name', 'hello');
    const shot = await browser.screenshot(session, {});
    assert.ok(shot.artifact.startsWith('bl_'));
    assert.equal(browser.artifact(session, shot.artifact).mime, 'image/png');
    const consoleAfter = proxy.console(session).next;
    const startedAt = Date.now();
    await browser.click(session, '#err');
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.ok(proxy.console(session).entries.some(entry => entry.message.includes('fixture error')));
    const checkpoints = [];
    const uiCheck = await browser.captureCheckpoint(session, 'checkpoint-fixture', ['src/App.tsx'], startedAt, consoleAfter,
      (_session, kind, payload) => checkpoints.push({ kind, payload }));
    assert.equal(checkpoints[0]?.kind, 'checkpoint_screenshot');
    assert.equal(checkpoints[0]?.payload.checkpoint, 'checkpoint-fixture');
    assert.equal(checkpoints.length, 1);
    assert.ok(uiCheck?.errors > 0);
    assert.ok(uiCheck?.entries.some(entry => entry.message.includes('fixture error')));
    db = openStore(join(root, 'store.db'));
    createSession(db, { id: session, machine: newId('m'), project: root, vendor: 'fake', transport: 'cli', cwd: root });
    const sent = [];
    const promptEvents = [];
    const uiCheckEvents = [];
    const delivery = createPromptDelivery({
      db, notesDir: root, paused: new Set(), heldPrompts: new Map(), lastPrompt: new Map(),
      ensureWorker: async () => undefined,
      toWorker: async (_session, method, body) => { sent.push({ method, body }); return { type: 'res' }; },
      terminals: { recentOutput: () => undefined },
      previewEntries: (_session, ids) => proxy.console(session).entries.filter(entry => ids.includes(entry.id)),
      record: (_session, kind, payload) => { if (kind === 'prompt') promptEvents.push(payload); },
    });
    const userQueueId = newId('q');
    addQueuedPrompt(db, session, { id: userQueueId, text: 'later user prompt', createdAt: Date.now() });
    const queued = recordUiCheckResult(session, uiCheck, new UiCheckFollowupGuard(), delivery.enqueueAutoPrompt,
      (_session, kind, payload) => { if (kind === 'ui_check') uiCheckEvents.push(payload); });
    assert.equal(queued, true);
    assert.equal(listQueuedPrompts(db, session)[0]?.actor, 'auto');
    assert.equal(uiCheckEvents[0]?.followup, true);
    await delivery.drainQueue(session);
    assert.match(sent[0].body.text, /fixture error/);
    assert.equal(promptEvents[0]?.actor, 'auto');
    assert.equal(promptEvents[0]?.context[0]?.kind, 'console');
    assert.equal(listQueuedPrompts(db, session)[0]?.id, userQueueId);

    browser.setSettings({ checkpointScreenshots: true, uiCheck: true });
    const screenshotOnly = [];
    await browser.captureCheckpoint(session, 'non-ui-change', ['README.md'], Date.now(), proxy.console(session).next,
      (_session, kind) => screenshotOnly.push(kind));
    assert.deepEqual(screenshotOnly, ['checkpoint_screenshot']);
    browser.setSettings({ checkpointScreenshots: true, uiCheck: false });
    const settingOff = [];
    await browser.captureCheckpoint(session, 'ui-check-off', ['src/App.tsx'], Date.now(), proxy.console(session).next,
      (_session, kind) => settingOff.push(kind));
    assert.deepEqual(settingOff, ['checkpoint_screenshot']);
    browser.setSettings({ checkpointScreenshots: false, uiCheck: false });
    const before = checkpoints.length;
    await browser.captureCheckpoint(session, 'disabled', [], Date.now(), proxy.console(session).next,
      (_session, kind, payload) => checkpoints.push({ kind, payload }));
    assert.equal(checkpoints.length, before);
    const page = browser.page(session);
    await page.locator('#external').click().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(new URL(page.url()).origin, origin);
  } finally {
    db?.close();
    await browser.closeAll();
    await proxy.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (previousBrowserPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowserPath;
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
});
