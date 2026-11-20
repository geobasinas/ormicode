/**
 * Preload bridge: exposes a narrow `window.ormi` surface over IPC.
 * The renderer gets request/subscribe/unsubscribe/events/state/tokens —
 * never raw sockets, file paths or ipcRenderer itself.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { Frame } from '@ormicode/protocol';

export interface RemoteInfo { relayUrl: string; account: string; device: string; name: string; active?: boolean }

const bridge = {
  request: (method: string, body?: Record<string, unknown>): Promise<Frame> =>
    ipcRenderer.invoke('ormi:request', method, body),
  subscribe: (session: string, after?: number) => ipcRenderer.send('ormi:subscribe', session, after),
  unsubscribe: (session: string) => ipcRenderer.send('ormi:unsubscribe', session),
  onEvent: (cb: (frame: Frame) => void) => ipcRenderer.on('ormi:event', (_e, frame: Frame) => cb(frame)),
  onState: (cb: (state: string) => void) => ipcRenderer.on('ormi:state', (_e, state: string) => cb(state)),
  onRelayError: (cb: (msg: string) => void) => ipcRenderer.on('ormi:relayError', (_e, msg: string) => cb(msg)),
  tokenGet: (): Promise<string | undefined> => ipcRenderer.invoke('ormi:token:get'),
  tokenSet: (token: string): Promise<void> => ipcRenderer.invoke('ormi:token:set', token),
  pair: (args: { relay: string; account: string; code: string; name?: string }): Promise<{ device: string }> =>
    ipcRenderer.invoke('ormi:pair', args),
  unpair: (): Promise<void> => ipcRenderer.invoke('ormi:unpair'),
  remote: (): RemoteInfo | null => ipcRenderer.sendSync('ormi:remote:get'),
  linkIsLocal: (): boolean => ipcRenderer.sendSync('ormi:link:local'),
  storageBackend: (): string => ipcRenderer.sendSync('ormi:storageBackend'),
  hubLabel: (): string => ipcRenderer.sendSync('ormi:hubLabel'),
  winMin: () => ipcRenderer.send('ormi:win:min'),
  winMax: () => ipcRenderer.send('ormi:win:max'),
  winClose: () => ipcRenderer.send('ormi:win:close'),
  openPath: (absPath: string): Promise<string> => ipcRenderer.invoke('ormi:openPath', absPath),
  showItemInFolder: (absPath: string): void => {
    void ipcRenderer.invoke('ormi:showItemInFolder', absPath).catch(() => undefined);
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('ormi:pickFolder', 'Choose a project folder'),
  layoutRead: (): Promise<{ descriptor: unknown | null; errors: string[] }> => ipcRenderer.invoke('ormi:layout:read'),
  layoutWrite: (descriptor: unknown): Promise<void> => ipcRenderer.invoke('ormi:layout:write', descriptor),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('ormi:openExternal', url),
  previewClearData: (partition: string): Promise<void> => ipcRenderer.invoke('ormi:preview:clearData', partition),
};

contextBridge.exposeInMainWorld('ormi', bridge);
