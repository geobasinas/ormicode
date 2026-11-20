import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { findBrowser } from './browser-path.mjs';

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
