import type { WebContents, WebPreferences } from 'electron';
import { isBrowserUrl } from '@ormicode/client-platform';

export const browserPartition = /^(persist:)?ormi-preview-[a-z0-9]{1,32}$/;
export const allowBrowserGuest = (source: string, partition: string) => isBrowserUrl(source) && browserPartition.test(partition);

export function hardenBrowserPreferences(preferences: WebPreferences): void {
  delete preferences.preload;
  preferences.nodeIntegration = false;
  preferences.nodeIntegrationInWorker = false;
  preferences.nodeIntegrationInSubFrames = false;
  preferences.contextIsolation = true;
  preferences.sandbox = true;
  preferences.webSecurity = true;
  preferences.allowRunningInsecureContent = false;
  preferences.webviewTag = false;
  preferences.navigateOnDragDrop = false;
}

export function installBrowserNavigation(contents: WebContents): void {
  const guard = (event: { preventDefault(): void }, url: string) => { if (!isBrowserUrl(url)) event.preventDefault(); };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-frame-navigate', event => guard(event, event.url));
  contents.setWindowOpenHandler(({ url }) => {
    if (isBrowserUrl(url)) void contents.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });
}
