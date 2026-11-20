import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

function findBrowser() {
  const candidates = [process.env.UI_BROWSER];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA])
      if (base) candidates.push(join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe'));
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge'])
    for (const path of (process.env.PATH ?? '').split(delimiter)) candidates.push(join(path, name));
  return candidates.find(path => {
    if (!path) return false;
    try { accessSync(path, constants.X_OK); return true; } catch { return false; }
  });
}

test('a desktop connection delivered before App mounts boots the renderer', async t => {
  const executablePath = findBrowser();
  if (!executablePath) return t.skip('no chromium found');
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
  });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}test/desktop-state.html`);
  await page.getByRole('button', { name: 'Add project folder' }).waitFor();
  await page.getByRole('button', { name: 'No project', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('button', { name: 'Get started' }).count(), 0);
});
