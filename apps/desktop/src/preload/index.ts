/**
 * Preload bridge: exposes a narrow `window.ormi` surface over IPC.
 * The renderer gets request/subscribe/unsubscribe/events/state/tokens —
 * never raw sockets, file paths or ipcRenderer itself.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { Frame } from '@ormicode/protocol';

const bridge = {
  request: (method: string, body?: Record<string, unknown>): Promise<Frame> =>
    ipcRenderer.invoke('ormi:request', method, body),
  subscribe: (session: string, after?: number) => ipcRenderer.send('ormi:subscribe', session, after),
  unsubscribe: (session: string) => ipcRenderer.send('ormi:unsubscribe', session),
  onEvent: (cb: (frame: Frame) => void) => ipcRenderer.on('ormi:event', (_e, frame: Frame) => cb(frame)),
  onState: (cb: (state: string) => void) => ipcRenderer.on('ormi:state', (_e, state: string) => cb(state)),
  tokenGet: (): Promise<string | undefined> => ipcRenderer.invoke('ormi:token:get'),
  tokenSet: (token: string): Promise<void> => ipcRenderer.invoke('ormi:token:set', token),
  tokenClear: (): Promise<void> => ipcRenderer.invoke('ormi:token:clear'),
  hubLabel: (): string => ipcRenderer.sendSync('ormi:hubLabel'),
};

contextBridge.exposeInMainWorld('ormi', bridge);
