import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export function findBrowser() {
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
