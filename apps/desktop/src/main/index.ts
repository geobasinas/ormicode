/**
 * Electron main: window, daemon link and token store. All protocol
 * traffic lives here — the preload only forwards request/subscribe/
 * unsubscribe, and the renderer never touches sockets or tokens.
 *
 * Transport order: local daemon socket first; if a paired remote exists
 * (~/.ormicode/desktop/remote.json + safeStorage token), fall back to
 * the relay WebSocket. Pairing goes through `ormi:pair` IPC.
 */
import { app, BrowserWindow, ipcMain, safeStorage, screen } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import * as daemonSocket from '@ormicode/daemon/socket';
import { connectRemote, joinRemote } from '@ormicode/relay-client';
import type { WsLink } from '@ormicode/relay-client';
import type { Link } from '@ormicode/daemon/socket';
import type { Frame } from '@ormicode/protocol';

const socketPath = () => process.env.ORMICODE_SOCKET ?? daemonSocket.defaultSocketPath();
const desktopDir = join(daemonSocket.ormicodeDir(), 'desktop');
const tokenFile = join(desktopDir, 'device.token');
const remoteFile = join(desktopDir, 'remote.json');

interface RemoteFile { relayUrl: string; account: string; device: string; name: string }
type AnyLink = Link | WsLink;

let link: AnyLink | undefined;
let win: BrowserWindow | undefined;
let encryption = false;

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

function attachLink(l: AnyLink): void {
  link = l;
  state('online');
  l.onFrame = frame => send('ormi:event', frame);
  l.onClose = () => { state('offline'); setTimeout(() => void connectDaemon(), 5_000); };
}

async function connectDaemon(): Promise<void> {
  state('connecting');
  try {
    attachLink(await daemonSocket.connect(socketPath(), { v: 1, type: 'hello', role: 'client', proto: 1, device: 'desktop' }));
    return;
  } catch { /* no local daemon — try the relay */ }
  const remote = loadRemoteFile();
  const token = readToken();
  if (!remote || !token) { state(remote ? 'unpaired' : 'offline'); setTimeout(() => void connectDaemon(), 15_000); return; }
  try {
    attachLink(await connectRemote({ ...remote, token }, m => send('ormi:relayError', m)));
  } catch {
    state('offline');
    setTimeout(() => void connectDaemon(), 15_000);
  }
}

let restoreBounds: Electron.Rectangle | undefined;
let animTimer: ReturnType<typeof setInterval> | undefined;

function animateBounds(w: BrowserWindow, to: Electron.Rectangle, ms = 200): void {
  clearInterval(animTimer);
  const from = w.getBounds();
  const t0 = Date.now();
  animTimer = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    const l = (a: number, b: number) => Math.round(a + (b - a) * e);
    w.setBounds({ x: l(from.x, to.x), y: l(from.y, to.y), width: l(from.width, to.width), height: l(from.height, to.height) });
    if (p === 1) clearInterval(animTimer);
  }, 8);
}

function toggleMax(w: BrowserWindow): void {
  if (restoreBounds) { animateBounds(w, restoreBounds); restoreBounds = undefined; return; }
  restoreBounds = w.getBounds();
  animateBounds(w, screen.getDisplayMatching(restoreBounds).workArea);
}

function fadeOut(w: BrowserWindow, ms = 120): Promise<void> {
  return new Promise(resolve => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      w.setOpacity(1 - p);
      if (p === 1) { clearInterval(id); resolve(); }
    }, 8);
  });
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
    },
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  const ss = safeStorage as unknown as { isAsyncEncryptionAvailable?: () => Promise<boolean>; isEncryptionAvailable?: () => boolean };
  encryption = typeof ss.isAsyncEncryptionAvailable === 'function'
    ? await ss.isAsyncEncryptionAvailable().catch(() => false)
    : (ss.isEncryptionAvailable?.() ?? false);
  ipcMain.handle('ormi:request', async (_e, method: string, body?: Record<string, unknown>) => {
    if (!link) return { v: 1, type: 'err', id: 'local', code: 'daemon.offline', message: 'no daemon connection' } satisfies Partial<Frame>;
    try { return await link.request(method, body ?? {}); }
    catch (e) { return { v: 1, type: 'err', id: 'local', code: 'daemon.error', message: String(e) } satisfies Partial<Frame>; }
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
  ipcMain.on('ormi:remote:get', e => { e.returnValue = loadRemoteFile() ?? null; });
  ipcMain.on('ormi:storageBackend', e => {
    // getSelectedStorageBackend is newer; fall back to the availability probe.
    const b = safeStorage as unknown as { getSelectedStorageBackend?: () => string };
    e.returnValue = typeof b.getSelectedStorageBackend === 'function'
      ? b.getSelectedStorageBackend()
      : (encryption ? 'os_keyring' : 'basic_text');
  });
  ipcMain.on('ormi:hubLabel', e => { e.returnValue = loadRemoteFile()?.relayUrl ?? socketPath(); });
  ipcMain.on('ormi:win:min', () => { if (win) void fadeOut(win).then(() => { win?.minimize(); win?.setOpacity(1); }); });
  ipcMain.on('ormi:win:max', () => { if (win) toggleMax(win); });
  ipcMain.on('ormi:win:close', () => { if (win) void fadeOut(win).then(() => win?.close()); });

  createWindow();
  void connectDaemon();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
