import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { accessSync, constants, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const relayRoot = join(root, 'apps/relay');
const webRoot = join(root, 'apps/web');
const account = 'web-e2e';
const hubToken = 'web-e2e-hub-token';
const sha256 = value => createHash('sha256').update(value).digest('hex');
let relay;
let relayBuild;
let relayOrigin;
let webOrigin;
let server;
let browser;
let hub;
let version;
const commit = 'e2e-commit';

function findBrowser() {
  const candidates = [process.env.UI_BROWSER];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (base) candidates.push(join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe'));
    }
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge']) {
    for (const path of (process.env.PATH ?? '').split(delimiter)) candidates.push(join(path, name));
  }
  return candidates.find(path => {
    if (!path) return false;
    try { accessSync(path, constants.X_OK); return true; } catch { return false; }
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

class HubSimulator {
  constructor() {
    this.codes = new Map();
    this.messages = [];
    this.waiters = [];
    this.devices = new Map();
    this.counter = 0;
    this.onlineNotices = 0;
    this.statusRequests = 0;
  }

  async start() {
    this.socket = new WebSocket(`${relayOrigin.replace(/^http/, 'ws')}/connect?account=${account}`);
    this.socket.addEventListener('message', event => this.onMessage(String(event.data)));
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    const authed = this.waitFor(message => message.type === 'authed');
    this.send({ type: 'auth', token: hubToken });
    await authed;
  }

  send(message) { this.socket.send(JSON.stringify(message)); }

  waitFor(predicate) {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for hub message')), 10_000);
      this.waiters.push({ predicate, resolve: message => { clearTimeout(timer); resolve(message); } });
    });
  }

  onMessage(raw) {
    const message = JSON.parse(raw);
    if (message.type === 'pair.join') {
      const issued = this.codes.get(message.code.replace(/\s/g, ''));
      if (!issued || issued.used) { this.send({ type: 'pair.result', join: message.join, ok: false }); return; }
      issued.used = true;
      const device = `d_web_${++this.counter}`;
      const token = `web-e2e-device-${this.counter}`;
      this.devices.set(device, token);
      this.send({
        type: 'pair.result', join: message.join, ok: true, device, name: message.name,
        token, tokenHash: sha256(token), codeHash: sha256(issued.code),
      });
      return;
    }
    if (message.type === 'device.online') this.onlineNotices++;
    if (message.type === 'req') {
      if (message.method === 'daemon.status') this.statusRequests++;
      const body = message.method === 'daemon.status'
        ? { version: '0.0.0', proto: 1, uptimeMs: 1000, liveWorkers: 0, relay: 'connected', lastError: null }
        : message.method === 'session.list' ? { sessions: [] } : {};
      this.send({ v: 1, type: 'res', id: message.id, ok: true, body });
      return;
    }
    const waiter = this.waiters.findIndex(item => item.predicate(message));
    if (waiter === -1) this.messages.push(message);
    else this.waiters.splice(waiter, 1)[0].resolve(message);
  }

  async issue(code) {
    this.codes.set(code, { code, used: false });
    const response = await fetch(`${relayOrigin}/pair?account=${account}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${hubToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ codeHash: sha256(code), expiresAt: Date.now() + 60_000 }),
    });
    assert.equal(response.status, 200);
  }

  close() { this.socket?.close(); }
}

async function waitForWeb() {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`wrangler dev exited: ${server.exitCode}`);
    try {
      const response = await fetch(webOrigin);
      if (response.ok) return;
    } catch { /* wait for Wrangler's assets server */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('wrangler dev did not become ready');
}

async function pageWithRequests(context) {
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => requests.push({ url: request.url(), headers: request.headers(), method: request.method(), body: request.postData() }));
  return { page, requests };
}

async function waitUntil(check) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !check()) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(check(), 'condition did not become true');
}

function requestOrigin(value) {
  const origin = new URL(value).origin;
  return origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

async function enterCode(page, code) {
  await page.getByLabel('Account').fill(account);
  await page.getByLabel('Pairing code').fill(code);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
}

async function openAbout(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
}

before(async () => {
  const relayPort = await freePort();
  const webPort = await freePort();
  relayOrigin = `http://127.0.0.1:${relayPort}`;
  webOrigin = `http://127.0.0.1:${webPort}`;
  relayBuild = await mkdtemp(join(relayRoot, '.e2e-'));
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', relayBuild], { cwd: relayRoot, stdio: 'inherit' });
  const { Miniflare } = await import('miniflare');
  relay = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'], fallthrough: true }],
    scriptPath: join(relayBuild, 'index.js'),
    compatibilityDate: '2025-11-17',
    host: '127.0.0.1',
    port: relayPort,
    durableObjects: { ACCOUNT: { className: 'AccountDO', useSQLite: true } },
    r2Buckets: ['EVENTS'],
    bindings: { ALLOWED_ORIGINS: webOrigin },
  });
  await relay.ready;
  const registered = await fetch(`${relayOrigin}/register?account=${account}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hubToken }),
  });
  assert.equal(registered.status, 200);
  hub = new HubSimulator();
  await hub.start();
  execFileSync('pnpm', ['--filter', '@ormicode/web', 'build'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ORMI_RELAY_URL: relayOrigin, ORMI_COMMIT: commit },
  });
  const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'));
  version = pkg.version;
  server = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', 'wrangler.toml', '--port', String(webPort), '--ip', '127.0.0.1'], {
    cwd: webRoot, stdio: 'ignore', env: process.env, detached: process.platform !== 'win32',
  });
  await waitForWeb();
  const executablePath = findBrowser();
  if (executablePath) browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});

after(async () => {
  await browser?.close();
  hub?.close();
  if (server && server.exitCode === null) {
    if (process.platform === 'win32') server.kill();
    else {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
    }
  }
  await relay?.dispose();
  if (relayBuild) await rm(relayBuild, { recursive: true, force: true });
});

test('static assets have exact CSP, cache, and security headers', async t => {
  if (!browser) return t.skip('no chromium found');
  const page = await browser.newPage();
  const response = await page.goto(webOrigin);
  assert.equal(response.status(), 200);
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${relayOrigin} ${relayOrigin.replace(/^http/, 'ws')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
  assert.equal(response.headers()['content-security-policy'], csp);
  assert.equal(response.headers()['x-content-type-options'], 'nosniff');
  assert.equal(response.headers()['referrer-policy'], 'no-referrer');
  assert.equal(response.headers()['cache-control'], 'no-cache');
  const asset = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"][href]')].map(node => node.src || node.href).find(url => url.includes('/assets/')));
  assert.ok(asset);
  const assets = await fetch(asset);
  assert.equal(assets.headers.get('content-security-policy'), csp);
  assert.equal(assets.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('SPA serves /pair and scrubs pairing fragments before browser requests', async t => {
  if (!browser) return t.skip('no chromium found');
  const code = '910000000001';
  const context = await browser.newContext();
  const { page, requests } = await pageWithRequests(context);
  try {
    const fallback = await fetch(`${webOrigin}/pair`);
    assert.equal(fallback.status, 200);
    assert.match(await fallback.text(), /<div id="root"><\/div>/);
    await page.goto(`${webOrigin}/pair#a=${account}&c=${code}`);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(new URL(page.url()).hash, '');
    await page.getByLabel('Account').waitFor();
    assert.equal(await page.getByLabel('Account').inputValue(), account);
    assert.equal((await page.getByLabel('Pairing code').inputValue()).replace(/\s/g, ''), code);
    assert.ok(requests.every(request => !request.url.includes(code) && !request.headers.referer?.includes(code)));
    await hub.issue(code);
    await page.getByRole('button', { name: 'Pair', exact: true }).click();
    await page.getByRole('button', { name: 'Settings' }).waitFor();
    await openAbout(page);
    await page.getByText('online', { exact: true }).waitFor();
    await page.getByText(version, { exact: true }).waitFor();
    await page.getByText(commit, { exact: true }).waitFor();
    const pairing = requests.find(request => request.url.includes('/join'));
    assert.ok(pairing?.body?.includes(code));
    assert.ok(requests.every(request => [webOrigin, relayOrigin].includes(requestOrigin(request.url))));
  } finally { await context.close(); }
});

test('good pairing stores the token only in IndexedDB and shows an online connection', async t => {
  if (!browser) return t.skip('no chromium found');
  const code = '910000000002';
  await hub.issue(code);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(webOrigin);
    await enterCode(page, code);
    await page.getByRole('button', { name: 'Settings' }).waitFor();
    await openAbout(page);
    await page.getByText('online', { exact: true }).waitFor();
    const stored = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open('ormicode', 1);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const value = await new Promise((resolve, reject) => {
        const request = db.transaction('token', 'readonly').objectStore('token').get('device');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { token: value, localStorage: Object.values(localStorage) };
    });
    assert.match(stored.token, /^web-e2e-device-/);
    assert.equal(stored.localStorage.some(value => value.includes(stored.token)), false);
    const registrations = await page.evaluate(() => navigator.serviceWorker.getRegistrations());
    assert.equal(registrations.length, 0);
  } finally { await context.close(); }
});

test('bad and burned pairing codes are rejected', async t => {
  if (!browser) return t.skip('no chromium found');
  const code = '910000000003';
  await hub.issue(code);
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    await first.goto(webOrigin);
    await enterCode(first, '000000000000');
    await first.getByRole('alert').filter({ hasText: "That code didn't work." }).waitFor();
    await enterCode(first, code);
    await first.getByText('Pair this browser').waitFor({ state: 'detached' });
    await openAbout(first);
    await first.getByText('online', { exact: true }).waitFor();
    await second.goto(webOrigin);
    await enterCode(second, code);
    await second.getByRole('alert').filter({ hasText: "That code didn't work." }).waitFor();
  } finally { await first.close(); await second.close(); }
});

test('revocation clears the browser token and returns to pairing', async t => {
  if (!browser) return t.skip('no chromium found');
  const code = '910000000004';
  await hub.issue(code);
  const page = await browser.newPage();
  try {
    await page.goto(webOrigin);
    await enterCode(page, code);
    await page.getByRole('button', { name: 'Settings' }).waitFor();
    await openAbout(page);
    await page.getByText('online', { exact: true }).waitFor();
    const device = [...hub.devices.keys()].at(-1);
    const response = await fetch(`${relayOrigin}/revoke?account=${account}`, {
      method: 'POST', headers: { authorization: `Bearer ${hubToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    });
    assert.equal(response.status, 200);
    await page.getByText('Pair this browser').waitFor();
  } finally { await page.close(); }
});

test('a second tab takes over the relay connection when the leader closes', async t => {
  if (!browser) return t.skip('no chromium found');
  const code = '910000000005';
  await hub.issue(code);
  const context = await browser.newContext();
  const leader = await context.newPage();
  const follower = await context.newPage();
  try {
    await leader.goto(webOrigin);
    await enterCode(leader, code);
    await leader.getByRole('button', { name: 'Settings' }).waitFor();
    await follower.goto(webOrigin);
    const onlineBefore = hub.onlineNotices;
    const statusBefore = hub.statusRequests;
    await leader.close();
    await waitUntil(() => hub.onlineNotices > onlineBefore);
    await waitUntil(() => hub.statusRequests > statusBefore);
    const response = await follower.evaluate(() => new Promise((resolve, reject) => {
      const channel = new BroadcastChannel('ormicode');
      const id = 'e2e_request_after_takeover';
      const timeout = setTimeout(() => { channel.close(); reject(new Error('follower request timed out')); }, 10_000);
      channel.addEventListener('message', event => {
        if (event.data?.t !== 'res' || event.data.id !== id) return;
        clearTimeout(timeout);
        channel.close();
        resolve(event.data.frame);
      });
      channel.postMessage({ t: 'req', id, method: 'session.list', body: {}, tab: 'e2e' });
    }));
    assert.equal(response.type, 'res');
    assert.deepEqual(response.body.sessions, []);
  } finally { await context.close(); }
});
