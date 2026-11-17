/**
 * Electron main: window, daemon link and token store. All protocol
 * traffic lives here — the preload only forwards request/subscribe/
 * unsubscribe, and the renderer never touches sockets or tokens.
 */
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as daemonSocket from '@ormicode/daemon/socket';
import type { Link } from '@ormicode/daemon/socket';
import type { Frame } from '@ormicode/protocol';

const socketPath = () => process.env.ORMICODE_SOCKET ?? daemonSocket.defaultSocketPath();
const tokenFile = join(daemonSocket.ormicodeDir(), 'desktop', 'device.token');

let link: Link | undefined;
let win: BrowserWindow | undefined;

const send = (channel: string, payload: unknown) => { if (!win?.isDestroyed()) win?.webContents.send(channel, payload); };

async function connectDaemon(): Promise<void> {
  send('ormi:state', 'connecting');
  try {
    link = await daemonSocket.connect(socketPath(), { v: 1, type: 'hello', role: 'client', proto: 1, device: 'desktop' });
  } catch {
    link = undefined;
    send('ormi:state', 'offline');
    setTimeout(() => void connectDaemon(), 5_000);
    return;
  }
  send('ormi:state', 'online');
  link.onFrame = frame => send('ormi:event', frame);
  link.onClose = () => { send('ormi:state', 'offline'); setTimeout(() => void connectDaemon(), 5_000); };
}

function readToken(): string | undefined {
  try {
    const raw = readFileSync(tokenFile);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch { return undefined; }
}
function writeToken(token: string): void {
  mkdirSync(join(daemonSocket.ormicodeDir(), 'desktop'), { recursive: true });
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
  writeFileSync(tokenFile, data, { mode: 0o600 });
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
  ipcMain.handle('ormi:token:clear', () => { try { writeFileSync(tokenFile, '', { mode: 0o600 }); } catch { /* absent */ } });
  ipcMain.on('ormi:hubLabel', e => { e.returnValue = socketPath(); });

  createWindow();
  void connectDaemon();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
