import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const outDir = join(root, '.ui-out');
export const designsDir = join(root, 'designs', 'desktop');
export const MOCKUP_SIZE = { width: 1441, height: 901 };

export function args(argv = process.argv.slice(2)) {
  const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else rest.push(argv[i]);
  }
  return { flags, rest };
}

export function out(name) { mkdirSync(outDir, { recursive: true }); return join(outDir, name); }

/** Launches the built desktop app (run `pnpm --filter @ormicode/desktop build` first). */
export async function launchApp({ width = MOCKUP_SIZE.width, height = MOCKUP_SIZE.height, scale = 1 } = {}) {
  const entry = join(root, 'apps/desktop/out/main/index.cjs');
  if (!existsSync(entry)) throw new Error('desktop is not built: run `pnpm --filter @ormicode/desktop build`');
  const electronPath = createRequire(join(root, 'apps/desktop/package.json'))('electron');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const flags = scale === 1 ? [] : [`--force-device-scale-factor=${scale}`];
  const app = await electron.launch({ executablePath: electronPath, args: [...flags, entry], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]);
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.waitForTimeout(400);
  return { app, page };
}

export async function openFirstSession(page) {
  const row = page.locator('text=RECENT SESSIONS').locator('xpath=following::button[1]');
  if (!(await row.count())) return false;
  await row.click(); await page.waitForTimeout(1000);
  return true;
}

export function mockupPath(name) {
  const want = name.toLowerCase();
  const file = readdirSync(designsDir).filter(f => f.endsWith('.svg'))
    .find(f => f.toLowerCase().replace('desktop — ', '').replace('.svg', '') === want)
    ?? readdirSync(designsDir).filter(f => f.endsWith('.svg')).find(f => f.toLowerCase().includes(want));
  if (!file) throw new Error(`no mockup svg matching "${name}" in designs/desktop`);
  return join(designsDir, file);
}

export async function launchSvgBrowser() {
  const candidates = [process.env.UI_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
  const executablePath = candidates.find(existsSync);
  if (!executablePath) throw new Error('no Edge/Chrome found; set UI_BROWSER to a chromium executable');
  return chromium.launch({ executablePath });
}

export const round = n => Math.round(n * 10) / 10;
