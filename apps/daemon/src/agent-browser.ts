import { spawn } from 'node:child_process';
import { constants, accessSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { idSchema, newId } from '@ormicode/protocol';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { Services } from './services.ts';
import { previewLabel } from './preview-proxy.ts';

const UNAVAILABLE = 'No browser found. Run `ormi browser install` or set ORMICODE_BROWSER.';
const ARTIFACT_CAP = 4 * 1024 * 1024;
const IDLE_MS = 10 * 60_000;
const devices = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1280, height: 800 },
} as const;

export type BrowserSource = 'env' | 'installed' | 'system';
export interface BrowserFound { available: boolean; source: BrowserSource | null; path?: string }
interface BrowserPage { browser: Browser; context: BrowserContext; page: Page; allowed: Set<string>; timer: NodeJS.Timeout }
interface Settings { checkpointScreenshots: boolean }

function executable(path: string): boolean {
  try { accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; }
  catch { return false; }
}

function systemCandidates(env: NodeJS.ProcessEnv, os: NodeJS.Platform): string[] {
  const names = os === 'win32' ? ['chrome.exe', 'chromium.exe'] : ['google-chrome', 'chromium', 'chromium-browser'];
  const pathEntries = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const fromPath = pathEntries.flatMap(dir => names.map(name => join(dir, name)));
  if (os === 'darwin') return [...fromPath, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  if (os === 'win32') return [...fromPath,
    join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')];
  return fromPath;
}

function managedShells(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && (entry.name === 'headless_shell' || entry.name === 'chrome-headless-shell')) found.push(path);
      else if (entry.isDirectory()) visit(path, depth + 1);
    }
  };
  visit(root, 0);
  return found;
}

export function discoverBrowser(
  env: NodeJS.ProcessEnv = process.env,
  dataRoot = join(homedir(), '.ormicode'),
  os: NodeJS.Platform = platform(),
): BrowserFound {
  const override = env.ORMICODE_BROWSER;
  if (override && executable(resolve(override))) return { available: true, source: 'env', path: resolve(override) };
  const installed = managedShells(join(dataRoot, 'browsers')).find(executable);
  if (installed) return { available: true, source: 'installed', path: installed };
  const system = systemCandidates(env, os).find(executable);
  return system ? { available: true, source: 'system', path: system } : { available: false, source: null };
}

export class BrowserError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export class AgentBrowser {
  private readonly dataRoot: string;
  private readonly browsersPath: string;
  private readonly settingsPath: string;
  private readonly services: Services;
  private browser?: Browser;
  private launch?: Promise<Browser>;
  private readonly pages = new Map<string, BrowserPage>();
  private settings: Settings = { checkpointScreenshots: true };

  constructor(dataRoot: string, services: Services) {
    this.dataRoot = dataRoot;
    this.browsersPath = join(dataRoot, 'browsers');
    this.settingsPath = join(dataRoot, 'browser-settings.json');
    this.services = services;
    try {
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<Settings>;
      if (typeof parsed.checkpointScreenshots === 'boolean') this.settings.checkpointScreenshots = parsed.checkpointScreenshots;
    } catch { /* Use the default until a setting has been saved. */ }
  }

  status(): BrowserFound { return discoverBrowser(process.env, this.dataRoot); }
  getSettings(): Settings { return { ...this.settings }; }

  setSettings(settings: Settings): Settings {
    this.settings = { ...settings };
    mkdirSync(dirname(this.settingsPath), { recursive: true, mode: 0o700 });
    writeFileSync(this.settingsPath, JSON.stringify(this.settings), { mode: 0o600 });
    return this.getSettings();
  }

  async install(): Promise<{ installed: true; path: string }> {
    mkdirSync(this.browsersPath, { recursive: true, mode: 0o700 });
    const require = createRequire(import.meta.url);
    const cli = require.resolve('playwright-core/cli.js');
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [cli, 'install', 'chromium-headless-shell'], {
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: this.browsersPath }, stdio: 'inherit', windowsHide: true,
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`browser installer exited with ${code ?? 'no code'}`)));
    });
    const path = managedShells(this.browsersPath).find(executable);
    if (!path) throw new BrowserError('browser.unavailable', UNAVAILABLE);
    return { installed: true, path };
  }

  private async playwright() {
    process.env.PLAYWRIGHT_BROWSERS_PATH = this.browsersPath;
    return import('playwright-core');
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launch) return this.launch;
    const found = this.status();
    if (!found.available || !found.path) throw new BrowserError('browser.unavailable', UNAVAILABLE);
    this.launch = (async () => {
      const { chromium } = await this.playwright();
      try {
        const browser = await chromium.launch({
          executablePath: found.path, headless: true,
          ...(process.platform === 'linux' ? { args: ['--no-sandbox'] } : {}),
        });
        this.browser = browser;
        browser.on('disconnected', () => { this.browser = undefined; });
        return browser;
      } finally { this.launch = undefined; }
    })();
    return this.launch;
  }

  private touch(session: string, state: BrowserPage): void {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { void this.closeSession(session); }, IDLE_MS).unref();
  }

  private async context(session: string, device?: keyof typeof devices): Promise<BrowserPage> {
    let state = this.pages.get(session);
    if (state?.context.pages().length) {
      if (device) await state.page.setViewportSize(devices[device]);
      this.touch(session, state);
      return state;
    }
    if (state) {
      this.pages.delete(session);
      await state.context.close().catch(() => undefined);
      if (!this.pages.size && state.browser.isConnected()) await state.browser.close().catch(() => undefined);
    }
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({ viewport: devices[device ?? 'desktop'] });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const fresh: BrowserPage = { browser, context, page, allowed: new Set(), timer: setTimeout(() => undefined, IDLE_MS).unref() };
    await context.route('**/*', route => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        let origin = '';
        try { origin = new URL(request.url()).origin; } catch { /* Block malformed main-frame URLs. */ }
        if (!fresh.allowed.has(origin)) return route.fulfill({ status: 204 });
      }
      return route.continue();
    });
    this.pages.set(session, fresh);
    this.touch(session, fresh);
    return fresh;
  }

  async open(session: string, url: string, allowedOrigins: string[], device?: keyof typeof devices) {
    const state = await this.context(session, device);
    state.allowed = new Set(allowedOrigins);
    await state.page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    this.touch(session, state);
    return this.describe(session);
  }

  page(session: string): Page | undefined {
    const state = this.pages.get(session);
    if (state) this.touch(session, state);
    return state?.page;
  }

  async describe(session: string): Promise<{ url: string; title: string }> {
    const page = this.pages.get(session)?.page;
    if (!page) return { url: '', title: '' };
    const [url, title] = await Promise.all([Promise.resolve(page.url()), page.title().catch(() => '')]);
    return { url, title };
  }

  async click(session: string, selector: string) {
    const page = this.page(session);
    if (!page) throw new BrowserError('browser.action_failed', 'Open a preview before clicking.');
    await page.locator(selector).click({ timeout: 10_000 });
    return this.describe(session);
  }

  async type(session: string, selector: string, text: string, submit = false) {
    const page = this.page(session);
    if (!page) throw new BrowserError('browser.action_failed', 'Open a preview before typing.');
    const locator = page.locator(selector);
    await locator.fill(text, { timeout: 10_000 });
    if (submit) await locator.press('Enter', { timeout: 10_000 });
    return this.describe(session);
  }

  async snapshot(session: string) {
    const page = this.page(session);
    if (!page) throw new BrowserError('browser.action_failed', 'Open a preview before taking a snapshot.');
    const snapshot = await page.locator('body').ariaSnapshot();
    const bytes = Buffer.from(snapshot);
    return { ...await this.describe(session), snapshot: bytes.subarray(0, 20 * 1024).toString('utf8') };
  }

  async screenshot(session: string, options: { fullPage?: boolean; selector?: string }) {
    const page = this.page(session);
    if (!page) throw new BrowserError('browser.action_failed', 'Open a preview before taking a screenshot.');
    const id = newId('bl');
    const directory = join(this.dataRoot, 'sessions', session, 'browser');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = join(directory, `${id}.png`);
    const locator = options.selector ? page.locator(options.selector) : undefined;
    const screenshotOptions = { type: 'png' as const, ...(options.fullPage && !locator ? { fullPage: true } : {}) };
    const png = locator ? await locator.screenshot(screenshotOptions) : await page.screenshot(screenshotOptions);
    if (png.length > ARTIFACT_CAP) throw new BrowserError('browser.action_failed', 'Screenshot exceeds the 4 MiB artifact limit.');
    writeFileSync(target, png, { mode: 0o600, flag: 'wx' });
    let jpeg: Buffer;
    if (locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      const viewport = page.viewportSize() ?? devices.desktop;
      if (!box) throw new BrowserError('browser.action_failed', 'Screenshot selector is not visible.');
      const x = Math.max(0, box.x);
      const y = Math.max(0, box.y);
      const width = Math.min(box.width, 1280, viewport.width - x);
      const height = Math.min(box.height, viewport.height - y);
      if (width <= 0 || height <= 0) throw new BrowserError('browser.action_failed', 'Screenshot selector is outside the viewport.');
      jpeg = await page.screenshot({ type: 'jpeg', quality: 70, scale: 'css', clip: { x, y, width, height } });
    } else {
      jpeg = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: Boolean(options.fullPage), scale: 'css' });
    }
    return { ...await this.describe(session), artifact: id, jpeg: jpeg.toString('base64') };
  }

  artifact(session: string, id: string): { mime: string; data: string } {
    if (!idSchema('bl').safeParse(id).success) throw new BrowserError('browser.not_found', 'Artifact not found.');
    const target = join(this.dataRoot, 'sessions', session, 'browser', `${id}.png`);
    let size = 0;
    try { size = statSync(target).size; } catch { throw new BrowserError('browser.not_found', 'Artifact not found.'); }
    if (size > ARTIFACT_CAP) throw new BrowserError('browser.action_failed', 'Artifact exceeds the 4 MiB limit.');
    return { mime: 'image/png', data: readFileSync(target).toString('base64') };
  }

  async closeSession(session: string): Promise<void> {
    const state = this.pages.get(session);
    if (!state) return;
    this.pages.delete(session);
    clearTimeout(state.timer);
    await state.context.close().catch(() => undefined);
    if (!this.pages.size && state.browser.isConnected()) await state.browser.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.pages.keys()];
    await Promise.all(sessions.map(session => this.closeSession(session)));
    if (this.browser?.isConnected()) await this.browser.close().catch(() => undefined);
    this.browser = undefined;
  }

  async deleteSession(session: string): Promise<void> {
    await this.closeSession(session);
    rmSync(join(this.dataRoot, 'sessions', session), { recursive: true, force: true });
  }

  async captureCheckpoint(session: string, checkpoint: string, record: (session: string, kind: string, payload: Record<string, unknown>) => void): Promise<void> {
    if (!this.settings.checkpointScreenshots) return;
    let created = false;
    try {
      const listed = await this.services.list(session) as {
        proxy: { port: number }; ports: { base: number; count: number };
        services: { state: string; port: number; portals: { path: string }[] }[];
      };
      const service = listed.services.find(item => item.state === 'running');
      if (!service) return;
      let state = this.pages.get(session);
      if (!state || !state.page.url() || state.page.url() === 'about:blank') {
        const path = service.portals[0]?.path ?? '/';
        const target = await this.services.previewUrl(session, service.port, path);
        const origins = Array.from({ length: listed.ports.count }, (_, offset) =>
          `http://${previewLabel(session, listed.ports.base + offset)}:${listed.proxy.port}`);
        await this.open(session, target, origins);
        state = this.pages.get(session);
        created = true;
      }
      if (!state) return;
      await state.page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
      await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
      const result = await this.screenshot(session, {});
      record(session, 'checkpoint_screenshot', { checkpoint, artifact: result.artifact, url: result.url, actor: 'auto' });
    } catch { /* A checkpoint screenshot never changes the result of a turn. */ }
    finally { if (created) await this.closeSession(session); }
  }
}
