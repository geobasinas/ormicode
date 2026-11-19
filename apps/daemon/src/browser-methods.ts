import { previewLabel } from './preview-proxy.ts';
import { BrowserError, type AgentBrowser } from './agent-browser.ts';
import type { Client, DispatchCtx } from './dispatch.ts';

interface BrowserServices {
  ports: { base: number; count: number };
  proxy: { port: number };
  services: { state: string; port: number; portals: { path: string }[] }[];
  detected: { port: number }[];
}

function allowedPorts(session: string, listed: BrowserServices) {
  return Array.from({ length: listed.ports.count }, (_, offset) => {
    const port = listed.ports.base + offset;
    return {
      port,
      origin: `http://${previewLabel(session, port)}.localhost:${listed.proxy.port}`,
    };
  });
}

function existingPreviewPorts(listed: BrowserServices): Set<number> {
  return new Set([...listed.services.map(service => service.port), ...listed.detected.map(item => item.port)]);
}

export function destination(session: string, body: Record<string, unknown>, listed: BrowserServices) {
  const ports = allowedPorts(session, listed);
  const existing = existingPreviewPorts(listed);
  if (typeof body.url === 'string') {
    let parsed: URL;
    try { parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(body.url) ? body.url : `http://${body.url}`); }
    catch { throw new BrowserError('browser.not_allowed', 'URL is not an allowed preview address.'); }
    if (parsed.username || parsed.password || parsed.protocol !== 'http:') throw new BrowserError('browser.not_allowed', 'Only this session’s local preview URLs are allowed.');
    const localPort = Number(parsed.port);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      if (!ports.some(item => item.port === localPort)) throw new BrowserError('browser.not_allowed', 'URL port is outside this session’s port block.');
      return { port: localPort, path: `${parsed.pathname}${parsed.search}${parsed.hash}` || '/' };
    }
    const preview = ports.find(item => existing.has(item.port) && parsed.origin === item.origin);
    if (preview) {
      const path = parsed.pathname === '/__ormi/auth'
        ? parsed.searchParams.get('to') ?? '/'
        : `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return { port: preview.port, path };
    }
    throw new BrowserError('browser.not_allowed', 'URL is not an existing preview origin for this session.');
  }
  let port = typeof body.port === 'number' ? body.port : undefined;
  const inBlock = (candidate: number) => candidate >= listed.ports.base && candidate < listed.ports.base + listed.ports.count;
  if (port !== undefined && !inBlock(port)) throw new BrowserError('browser.not_allowed', 'Port is outside this session’s port block.');
  if (port === undefined) {
    port = listed.services.find(service => service.state === 'running')?.port
      ?? listed.detected[0]?.port;
  }
  if (port === undefined) throw new BrowserError('browser.not_found', 'No running service or detected port is available.');
  return { port, path: typeof body.path === 'string' ? body.path : '/' };
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function action(
  ctx: DispatchCtx, client: Client, id: string, method: string, session: string,
  operation: () => Promise<Record<string, unknown>>, target?: string,
): Promise<void> {
  const startedAt = Date.now();
  let after = 0;
  try { after = ctx.services.previewConsole(session).next; } catch { /* The action will return the session error. */ }
  try {
    const result = await operation();
    const settleMs = Math.max(0, 520 - (Date.now() - startedAt));
    if (settleMs) await new Promise(resolve => setTimeout(resolve, settleMs));
    const entries = ctx.services.previewConsole(session, after).entries;
    const consoleErrors = entries.filter(entry => entry.level === 'error').length;
    const url = String(result.url ?? '');
    ctx.record(session, 'browser_action', {
      action: method.slice('browser.'.length), ...(target ? { target } : {}), url, ok: true,
      ...(typeof result.artifact === 'string' ? { artifact: result.artifact } : {}),
      actor: client.device === 'mcp' ? 'agent' : 'user',
    });
    client.link.reply(id, { ...result, consoleErrors });
  } catch (error) {
    const code = error instanceof BrowserError ? error.code : 'browser.action_failed';
    const detail = message(error);
    const url = (await ctx.agentBrowser.describe(session).catch(() => ({ url: '' }))).url;
    ctx.record(session, 'browser_action', {
      action: method.slice('browser.'.length), ...(target ? { target } : {}), url, ok: false, error: detail,
      actor: client.device === 'mcp' ? 'agent' : 'user',
    });
    client.link.replyError(id, code, detail);
  }
}

export async function browserMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  const browser = ctx.agentBrowser;
  if (method === 'browser.status') return client.link.reply(id, { ...browser.status() });
  if (method === 'browser.settings') return client.link.reply(id, { ...browser.getSettings() });
  if (method === 'browser.setSettings') return client.link.reply(id, { ...browser.setSettings({
    checkpointScreenshots: Boolean(body.checkpointScreenshots), uiCheck: Boolean(body.uiCheck),
  }) });
  if (method === 'browser.diff') {
    try { return client.link.reply(id, { ...browser.diff(String(body.session), String(body.a), String(body.b)) }); }
    catch (error) { return client.link.replyError(id, error instanceof BrowserError ? error.code : 'browser.action_failed', message(error)); }
  }
  if (method === 'browser.install') {
    try { return client.link.reply(id, await browser.install()); }
    catch (error) {
      return client.link.replyError(id, error instanceof BrowserError ? error.code : 'browser.action_failed', message(error));
    }
  }
  const session = String(body.session);
  if (method === 'browser.open') {
    await action(ctx, client, id, method, session, async () => {
      const listed = await ctx.services.list(session) as unknown as BrowserServices;
      const target = destination(session, body, listed);
      const url = await ctx.services.previewUrl(session, target.port, target.path);
      const existing = existingPreviewPorts(listed);
      const origins = allowedPorts(session, listed).filter(item => existing.has(item.port) || item.port === target.port).map(item => item.origin);
      return ctx.agentBrowser.open(session, url, origins, body.device as 'phone' | 'tablet' | 'desktop' | undefined);
    }, String(body.path ?? body.url ?? '/'));
    return;
  }
  if (method === 'browser.click') {
    await action(ctx, client, id, method, session, async () => ctx.agentBrowser.click(session, String(body.selector)), String(body.selector));
    return;
  }
  if (method === 'browser.type') {
    await action(ctx, client, id, method, session, async () => ctx.agentBrowser.type(session, String(body.selector), String(body.text), Boolean(body.submit)), String(body.selector));
    return;
  }
  if (method === 'browser.snapshot') {
    await action(ctx, client, id, method, session, async () => ctx.agentBrowser.snapshot(session));
    return;
  }
  if (method === 'browser.screenshot') {
    await action(ctx, client, id, method, session, async () => ctx.agentBrowser.screenshot(session, {
      fullPage: Boolean(body.fullPage), ...(typeof body.selector === 'string' ? { selector: body.selector } : {}),
    }), typeof body.selector === 'string' ? body.selector : undefined);
    return;
  }
  if (method === 'browser.close') {
    await action(ctx, client, id, method, session, async () => {
      const details = await ctx.agentBrowser.describe(session);
      await ctx.agentBrowser.closeSession(session);
      return { ...details, closed: true };
    });
    return;
  }
  if (method === 'browser.artifact') {
    try { return client.link.reply(id, browser.artifact(session, String(body.id))); }
    catch (error) { return client.link.replyError(id, error instanceof BrowserError ? error.code : 'browser.not_found', message(error)); }
  }
  return client.link.replyError(id, 'protocol.unimplemented', method);
}
