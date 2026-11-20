/**
 * Electron main: window, daemon link and token store. All protocol
 * traffic lives here — the preload only forwards request/subscribe/
 * unsubscribe, and the renderer never touches sockets or tokens.
 *
 * Transport order: local daemon socket first; if a paired remote exists
 * (~/.ormicode/desktop/remote.json + safeStorage token), fall back to
 * the relay WebSocket. Pairing goes through `ormi:pair` IPC.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, session as electronSession, shell } from 'electron';
import { isAbsolute, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import * as daemonSocket from '@ormicode/daemon/socket';
import { connectRemote, joinRemote } from '@ormicode/relay-client';
import type { WsLink } from '@ormicode/relay-client';
import type { Link } from '@ormicode/daemon/socket';
import type { Frame } from '@ormicode/protocol';
import { allowBrowserGuest, browserPartition as previewPartition, hardenBrowserPreferences, installBrowserNavigation } from './browser-security.ts';

const socketPath = () => process.env.ORMICODE_SOCKET ?? daemonSocket.defaultSocketPath();
const desktopDir = join(daemonSocket.ormicodeDir(), 'desktop');
const tokenFile = join(desktopDir, 'device.token');
const remoteFile = join(desktopDir, 'remote.json');
const layoutFile = join(desktopDir, 'layout.json');
const layoutRegions = new Set(['sidebar', 'main', 'composer', 'rightRail', 'now.widgets', 'session.panel', 'approval']);

app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.localhost 127.0.0.1');

function layoutErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['layout is not an object'];
  const layout = value as { version?: unknown; regions?: unknown };
  const errors: string[] = [];
  if (layout.version !== 1) errors.push(`unsupported layout version ${String(layout.version)}`);
  if (!layout.regions || typeof layout.regions !== 'object' || Array.isArray(layout.regions)) return [...errors, 'layout regions are invalid'];
  for (const [id, raw] of Object.entries(layout.regions)) {
    if (!layoutRegions.has(id)) { errors.push(`unknown region ${id}`); continue; }
    if (!raw || typeof raw !== 'object') { errors.push(`region ${id} is invalid`); continue; }
    const region = raw as { order?: unknown; size?: unknown; visible?: unknown; collapsed?: unknown };
    if (typeof region.order !== 'number' || !Number.isFinite(region.order)) errors.push(`region ${id}: order must be a number`);
    if (region.size !== undefined && (typeof region.size !== 'number' || !Number.isFinite(region.size) || region.size <= 0))
      errors.push(`region ${id}: size must be positive`);
    if (region.visible !== undefined && typeof region.visible !== 'boolean') errors.push(`region ${id}: visible must be boolean`);
    if (region.collapsed !== undefined && typeof region.collapsed !== 'boolean') errors.push(`region ${id}: collapsed must be boolean`);
    if (id === 'approval' && region.visible === false) errors.push('approval surface cannot be hidden');
    if (id === 'approval' && typeof region.size === 'number' && region.size < 48) errors.push('approval surface cannot be smaller than 48px');
  }
  return errors;
}

interface RemoteFile { relayUrl: string; account: string; device: string; name: string }
type AnyLink = Link | WsLink;

let link: AnyLink | undefined;
let linkIsRemote = false;
let win: BrowserWindow | undefined;
let encryption = false;
const previewSessions = new Map<string, Set<string>>();
const previewHandlers = new Set<string>();
const previewHost = /^([a-z0-9]+)-(\d+)\.localhost$/;

function rememberPreview(session: string, value: unknown): void {
  if (typeof value !== 'string') return;
  try {
    const match = previewHost.exec(new URL(value).hostname);
    if (!match) return;
    const sessions = previewSessions.get(match[1]!) ?? new Set<string>();
    sessions.add(session);
    previewSessions.set(match[1]!, sessions);
  } catch { /* Ignore malformed preview URLs. */ }
}

function installPreviewProtocol(partition: string): void {
  if (previewHandlers.has(partition)) return;
  previewHandlers.add(partition);
  const guestSession = electronSession.fromPartition(partition);
  guestSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  guestSession.setPermissionCheckHandler(() => false);
  void guestSession.protocol.handle('http', async request => {
    if (!linkIsRemote || !link) return guestSession.fetch(request, { bypassCustomProtocolHandlers: true });
    let parsed: URL;
    try { parsed = new URL(request.url); } catch { return new Response('Invalid preview URL', { status: 400 }); }
    const match = previewHost.exec(parsed.hostname);
    if (!match) return guestSession.fetch(request, { bypassCustomProtocolHandlers: true });
    const sessions = match ? previewSessions.get(match[1]!) : undefined;
    if (!match || !sessions || sessions.size !== 1) return new Response('Preview host is not registered', { status: 403 });
    const session = [...sessions][0]!;
    const activeLink = link;
    const port = Number(match[2]);
    let body = '';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = request.body?.getReader();
      if (reader) for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > 10 * 1024 * 1024) { await reader.cancel(); return new Response('Preview request body too large', { status: 413 }); }
        chunks.push(part.value);
      }
      const all = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
      let binary = '';
      for (let index = 0; index < all.length; index += 0x8000) binary += String.fromCharCode(...all.subarray(index, index + 0x8000));
      body = btoa(binary);
    }
    const headers = Object.fromEntries(request.headers.entries());
    const first = await activeLink!.request('preview.fetch', {
      session, port, method: request.method, path: `${parsed.pathname}${parsed.search}`, headers, ...(body ? { body } : {}),
    });
    if (first.type !== 'res') return new Response(first.type === 'err' ? first.message : 'Preview unavailable', { status: first.type === 'err' && first.code === 'preview.too_large' ? 413 : 502 });
    const result = first.body as { status: number; headers: Record<string, string | string[]>; body: string; more?: string };
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(result.headers)) for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
    let current: { body: string; more?: string } | undefined = { body: result.body, more: result.more };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!current) { controller.close(); return; }
        const bytes = Uint8Array.from(atob(current.body), char => char.charCodeAt(0));
        if (bytes.length) controller.enqueue(bytes);
        if (!current.more) { current = undefined; controller.close(); return; }
        const next = await activeLink!.request('preview.fetchMore', { handle: current.more });
        if (!next || next.type !== 'res') { controller.error(new Error('Preview response stream ended.')); return; }
        current = next.body as { body: string; more?: string };
      },
    });
    return new Response([204, 304].includes(result.status) ? null : stream, { status: result.status, headers: responseHeaders });
  });
}

const send = (channel: string, payload: unknown) => { if (!win?.isDestroyed()) win?.webContents.send(channel, payload); };
const state = (s: string) => send('ormi:state', s);

function loadRemoteFile(): RemoteFile | undefined {
  try {
    const c = JSON.parse(readFileSync(remoteFile, 'utf8')) as RemoteFile;
    return c.relayUrl && c.account && c.device ? c : undefined;
  } catch { return undefined; }
}

function readToken(): string | undefined {
  try {
    const raw = readFileSync(tokenFile);
    return encryption ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch { return undefined; }
}
function writeToken(token: string): void {
  mkdirSync(desktopDir, { recursive: true });
  const data = encryption ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
  writeFileSync(tokenFile, data, { mode: 0o600 });
}

function checkedPath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || !existsSync(value))
    throw new Error('An existing absolute path is required');
  return value;
}

function attachLink(l: AnyLink, remote: boolean): void {
  link = l;
  linkIsRemote = remote;
  state('online');
  l.onFrame = frame => send('ormi:event', frame);
  l.onClose = () => { linkIsRemote = false; state('offline'); setTimeout(() => void connectDaemon(), 5_000); };
}

async function connectDaemon(): Promise<void> {
  state('connecting');
  try {
    attachLink(await daemonSocket.connect(socketPath(), { v: 1, type: 'hello', role: 'client', proto: 1, device: 'desktop' }), false);
    return;
  } catch { /* no local daemon — try the relay */ }
  const remote = loadRemoteFile();
  const token = readToken();
  if (!remote || !token) { state(remote ? 'unpaired' : 'offline'); setTimeout(() => void connectDaemon(), 15_000); return; }
  try {
    attachLink(await connectRemote({ ...remote, token }, m => send('ormi:relayError', m)), true);
  } catch {
    state('offline');
    setTimeout(() => void connectDaemon(), 15_000);
  }
}

let restoreBounds: Electron.Rectangle | undefined;
let animTimer: ReturnType<typeof setInterval> | undefined;

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function tween(ms: number, step: (e: number) => void): Promise<void> {
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      step(ease(p));
      if (p === 1) { clearInterval(animTimer); resolve(); }
    };
    clearInterval(animTimer);
    animTimer = setInterval(tick, 8);
  });
}

function animateBounds(w: BrowserWindow, to: Electron.Rectangle, ms = 260): Promise<void> {
  const from = w.getBounds();
  const l = (a: number, b: number, e: number) => Math.round(a + (b - a) * e);
  return tween(ms, e => w.setBounds({ x: l(from.x, to.x, e), y: l(from.y, to.y, e), width: l(from.width, to.width, e), height: l(from.height, to.height, e) }));
}

function toggleMax(w: BrowserWindow): void {
  if (restoreBounds) { void animateBounds(w, restoreBounds); restoreBounds = undefined; return; }
  restoreBounds = w.getBounds();
  void animateBounds(w, screen.getDisplayMatching(restoreBounds).workArea);
}

function fadeOut(w: BrowserWindow, ms = 140): Promise<void> {
  return tween(ms, e => w.setOpacity(1 - e));
}

async function minimizeAnimated(w: BrowserWindow): Promise<void> {
  const from = w.getBounds();
  const to = { x: from.x + Math.round(from.width * 0.06), y: from.y + Math.round(from.height * 0.14), width: Math.round(from.width * 0.88), height: Math.round(from.height * 0.88) };
  const l = (a: number, b: number, e: number) => Math.round(a + (b - a) * e);
  await tween(240, e => {
    w.setBounds({ x: l(from.x, to.x, e), y: l(from.y, to.y, e), width: l(from.width, to.width, e), height: l(from.height, to.height, e) });
    w.setOpacity(1 - e);
  });
  w.setBounds(from);
  w.minimize();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 720, minHeight: 480,
    title: 'ormicode',
    frame: false,
    transparent: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  win.webContents.on('will-attach-webview', (event, preferences, params) => {
    if (!allowBrowserGuest(params.src, params.partition ?? '')) { event.preventDefault(); return; }
    installPreviewProtocol(params.partition!);
    hardenBrowserPreferences(preferences);
  });
  win.on('restore', () => { const w = win; if (w) void tween(200, e => w.setOpacity(e)); });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    installBrowserNavigation(contents);
  });
  encryption = safeStorage.isEncryptionAvailable();
  ipcMain.handle('ormi:request', async (_e, method: string, body?: Record<string, unknown>) => {
    if (!link) return { v: 1, type: 'err', id: 'local', code: 'daemon.offline', message: 'no daemon connection' } satisfies Partial<Frame>;
    try {
      const response = await link.request(method, body ?? {});
      if (method === 'preview.url' && response.type === 'res' && typeof body?.session === 'string')
        rememberPreview(body.session, (response.body as { url?: unknown }).url);
      return response;
    }
    catch (e) { return { v: 1, type: 'err', id: 'local', code: 'daemon.error', message: String(e) } satisfies Partial<Frame>; }
  });
  // Opening a file hands it to its default app; never hand over something that would run.
  ipcMain.handle('ormi:openPath', (_e, absPath: unknown) => {
    const path = checkedPath(absPath);
    const st = statSync(path);
    if (st.isFile() && (/\.(exe|bat|cmd|com|msi|ps1|vbs|js|jar|sh|command|app|desktop|appimage|scr|lnk)$/i.test(path) || (process.platform !== 'win32' && (st.mode & 0o111) !== 0)))
      return 'Executable files are not opened from here';
    return shell.openPath(path);
  });
  ipcMain.handle('ormi:showItemInFolder', (_e, absPath: unknown) => shell.showItemInFolder(checkedPath(absPath)));
  ipcMain.handle('ormi:pickFolder', async (_e, title: unknown) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const picked = await dialog.showOpenDialog(win!, { title: typeof title === 'string' ? title : 'Choose a project folder', properties: ['openDirectory', 'createDirectory'] });
    return picked.canceled ? null : picked.filePaths[0] ?? null;
  });
  ipcMain.handle('ormi:layout:read', () => {
    try {
      const descriptor = JSON.parse(readFileSync(layoutFile, 'utf8')) as unknown;
      return { descriptor, errors: layoutErrors(descriptor) };
    } catch { return { descriptor: null, errors: [] }; }
  });
  ipcMain.handle('ormi:layout:write', (_e, descriptor: unknown) => {
    const errors = layoutErrors(descriptor);
    if (errors.length) throw new Error(`Invalid layout: ${errors.join('; ')}`);
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(layoutFile, JSON.stringify(descriptor, null, 2), { mode: 0o600 });
  });
  ipcMain.handle('ormi:openExternal', async (_e, value: unknown) => {
    if (typeof value !== 'string') throw new Error('An HTTP or HTTPS URL is required');
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS URLs can be opened');
    await shell.openExternal(url.toString());
  });
  ipcMain.handle('ormi:preview:clearData', async (_e, value: unknown) => {
    if (typeof value !== 'string' || !previewPartition.test(value)) throw new Error('Invalid preview partition');
    const partition = electronSession.fromPartition(value);
    await partition.clearStorageData();
    await partition.clearCache();
  });
  ipcMain.on('ormi:subscribe', (_e, session: string, after?: number) => {
    void link?.request('session.subscribe', { session, ...(after !== undefined ? { after } : {}) });
  });
  ipcMain.on('ormi:unsubscribe', (_e, session: string) => {
    void link?.request('session.unsubscribe', { session });
  });
  ipcMain.handle('ormi:token:get', () => readToken());
  ipcMain.handle('ormi:token:set', (_e, token: string) => writeToken(token));
  ipcMain.handle('ormi:pair', async (_e, args: { relay: string; account: string; code: string; name?: string }) => {
    const { device, token } = await joinRemote(args.relay, args.account, args.code, args.name ?? 'desktop');
    mkdirSync(desktopDir, { recursive: true });
    writeToken(token);
    writeFileSync(remoteFile, JSON.stringify({ relayUrl: args.relay, account: args.account, device, name: args.name ?? 'desktop' }, null, 2), { mode: 0o600 });
    link?.close();
    void connectDaemon();
    return { device };
  });
  ipcMain.handle('ormi:unpair', () => {
    try { rmSync(remoteFile); } catch { /* absent */ }
    try { rmSync(tokenFile); } catch { /* absent */ }
    link?.close();
    void connectDaemon();
  });
  ipcMain.on('ormi:remote:get', e => { const remote = loadRemoteFile(); e.returnValue = remote ? { ...remote, active: linkIsRemote } : null; });
  ipcMain.on('ormi:link:local', e => { e.returnValue = Boolean(link) && !linkIsRemote; });
  ipcMain.on('ormi:storageBackend', e => {
    // getSelectedStorageBackend is newer; fall back to the availability probe.
    const b = safeStorage as unknown as { getSelectedStorageBackend?: () => string };
    e.returnValue = typeof b.getSelectedStorageBackend === 'function'
      ? b.getSelectedStorageBackend()
      : (encryption ? 'os_keyring' : 'basic_text');
  });
  ipcMain.on('ormi:hubLabel', e => { e.returnValue = loadRemoteFile()?.relayUrl ?? socketPath(); });
  ipcMain.on('ormi:win:min', () => { if (win) void minimizeAnimated(win); });
  ipcMain.on('ormi:win:max', () => { if (win) toggleMax(win); });
  ipcMain.on('ormi:win:close', () => { if (win) void fadeOut(win).then(() => win?.close()); });

  createWindow();
  void connectDaemon();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
