/**
 * Electron main: window, daemon link and token store. All protocol
 * traffic lives here — the preload only forwards request/subscribe/
 * unsubscribe, and the renderer never touches sockets or tokens.
 *
 * Transport order: local daemon socket first; if a paired remote exists
 * (~/.ormicode/desktop/remote.json + safeStorage token), fall back to
 * the relay WebSocket. Pairing goes through `ormi:pair` IPC.
 */
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
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
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch { return undefined; }
}
function writeToken(token: string): void {
  mkdirSync(desktopDir, { recursive: true });
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 720, minHeight: 480,
    backgroundColor: '#101010',
    title: 'ormicode',
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

app.whenReady().then(() => {
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
  ipcMain.on('ormi:storageBackend', e => { e.returnValue = safeStorage.getSelectedStorageBackend(); });
  ipcMain.on('ormi:hubLabel', e => { e.returnValue = loadRemoteFile()?.relayUrl ?? socketPath(); });

  createWindow();
  void connectDaemon();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
