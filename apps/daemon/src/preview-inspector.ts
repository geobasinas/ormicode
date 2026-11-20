import { randomUUID } from 'node:crypto';
import { isInspectorHttpFailure, serializeInspectorValue, trimInspectorStack } from './preview-inspector-helpers.ts';

export type PreviewConsoleKind = 'console' | 'error' | 'rejection' | 'network';
export type PreviewConsoleEntry = {
  id: string; seq: number; ts: number; port: number; path: string;
  kind: PreviewConsoleKind; level: 'error' | 'warn'; message: string;
  stack?: string; source?: string; line?: number; col?: number;
  method?: string; url?: string; status?: number; durationMs?: number;
  requestBody?: string; responseBody?: string;
};
type IncomingEntry = Record<string, unknown>;

export function truncateInspectorText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 14))}[truncated]`;
}

export function parseReactDebugStack(stack: string): string | undefined {
  for (const line of stack.split(/\r?\n/)) {
    const match = line.match(/(?:at\s+.*?\s+\()?((?:file:\/\/)?[^()\s]+):(\d+):(\d+)\)?$/);
    if (!match || /node_modules|react-dom|<anonymous>/.test(match[1]!)) continue;
    return `${match[1]!.replace(/\?t=[^:]+$/, '')}:${match[2]}:${match[3]}`;
  }
  return undefined;
}

export function buildElementSelector(element: any, unique: (selector: string) => boolean): string {
  const css = (globalThis as unknown as { CSS?: { escape?: (value: string) => string } }).CSS;
  const escape = (value: string) => css?.escape ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  if (element.id) {
    const id = `#${escape(element.id)}`;
    if (unique(id)) return id;
  }
  const testId = element.getAttribute?.('data-testid');
  if (testId) {
    const selector = `[data-testid="${testId.replace(/["\\]/g, '\\$&')}"]`;
    if (unique(selector)) return selector;
  }
  const parts: string[] = [];
  let node = element;
  while (node && node.nodeType === 1) {
    let part = node.tagName.toLowerCase();
    if (node.id) part += `#${escape(node.id)}`;
    else {
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((child: any) => child.tagName === node.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (unique(candidate)) return candidate;
    node = node.parentElement;
  }
  return parts.join(' > ') || element.tagName.toLowerCase();
}

export const previewInspectorScript = String.raw`(() => {
  try {
  if (window.__ormiPreview) return;
  const buildSelector = (${buildElementSelector.toString()});
  const previewValue = (${serializeInspectorValue.toString()});
  const trimStack = (${trimInspectorStack.toString()});
  const failedStatus = (${isInspectorHttpFailure.toString()});
  const cap = (value, size) => {
    return previewValue(value, size);
  };
  const sourceFrame = (stack) => {
    if (!stack) return undefined;
    for (const line of String(stack).split(/\r?\n/)) {
      const match = line.match(/(?:at\s+.*?\s+\()?((?:file:\/\/)?[^()\s]+):(\d+):(\d+)\)?$/);
      if (!match || /node_modules|react-dom|<anonymous>/.test(match[1])) continue;
      return match[1].replace(/\?t=[^:]+$/, '') + ':' + match[2] + ':' + match[3];
    }
  };
  const entries = [];
  let sending = false;
  const reportUrl = '/__ormi/report';
  const isReport = (value) => {
    try { return new URL(value, location.href).pathname === reportUrl; } catch { return false; }
  };
  const add = (entry) => {
    try {
      if (isReport(entry.url)) return;
      entries.push({
        kind: entry.kind || 'network', level: entry.level || 'error',
        message: cap(entry.message, 4096), path: cap(location.pathname + location.search, 2048),
        ...(entry.stack ? { stack: cap(entry.stack, 8192), source: sourceFrame(entry.stack) } : {}),
        ...(entry.source ? { source: cap(entry.source, 2048) } : {}),
        ...(entry.line ? { line: entry.line } : {}), ...(entry.col ? { col: entry.col } : {}),
        ...(entry.method ? { method: cap(entry.method, 32) } : {}),
        ...(entry.url && !isReport(entry.url) ? { url: cap(entry.url, 2048) } : {}),
        ...(entry.status ? { status: entry.status } : {}),
        ...(Number.isFinite(entry.durationMs) ? { durationMs: Math.max(0, Math.round(entry.durationMs)) } : {}),
        ...(entry.requestBody ? { requestBody: cap(entry.requestBody, 2048) } : {}),
        ...(entry.responseBody ? { responseBody: cap(entry.responseBody, 2048) } : {}),
      });
      if (entries.length >= 20) void flush();
    } catch (_) {}
  };
  const payloads = () => {
    const batches = [];
    let batch = [];
    for (const entry of entries) {
      const candidate = batch.concat([entry]);
      if (batch.length && (candidate.length > 50 || JSON.stringify({ path: location.pathname + location.search, entries: candidate }).length > 60000)) {
        batches.push(batch); batch = [entry];
      } else batch = candidate;
    }
    if (batch.length) batches.push(batch);
    return batches;
  };
  const flush = async (beacon) => {
    if (sending || !entries.length) return;
    sending = true;
    const batches = payloads();
    const count = batches.reduce((sum, batch) => sum + batch.length, 0);
    const pending = entries.splice(0, count);
    try {
      for (const batch of batches) {
        const body = JSON.stringify({ path: location.pathname + location.search, entries: batch });
        if (beacon && navigator.sendBeacon) navigator.sendBeacon(reportUrl, new Blob([body], { type: 'application/json' }));
        else await fetch(reportUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin', keepalive: true });
      }
    } catch (_) { /* Reporting must never affect the page. */ }
    finally { sending = false; if (pending.length && entries.length) setTimeout(() => void flush(false), 0); }
  };
  const excerpt = async (response) => {
    const type = response.headers.get('content-type') || '';
    if (!/^(text\/|application\/(json|xml|javascript))/.test(type)) return '';
    try {
      const reader = response.clone().body.getReader();
      const chunks = []; let size = 0;
      while (size < 2048) {
        const part = await reader.read(); if (part.done) break;
        const take = part.value.subarray(0, 2048 - size); chunks.push(take); size += take.length;
        if (take.length < part.value.length) break;
      }
      void reader.cancel();
      return new TextDecoder().decode(chunks.reduce((all, chunk) => {
        const next = new Uint8Array(all.length + chunk.length); next.set(all); next.set(chunk, all.length); return next;
      }, new Uint8Array()));
    } catch (_) { return ''; }
  };
  for (const method of ['error', 'warn']) {
    const original = console[method];
    console[method] = function() {
      try {
        const args = Array.from(arguments);
        const error = args.find(value => value instanceof Error);
        add({ kind: 'console', level: method, message: args.map(value => cap(value, 2048)).join(' '),
          stack: trimStack(error && error.stack || new Error().stack || '') });
      } catch (_) {}
      return original.apply(this, arguments);
    };
  }
  const seenErrors = new WeakSet();
  window.addEventListener('error', event => {
    try {
      if (event.error && seenErrors.has(event.error)) return;
      if (event.error) seenErrors.add(event.error);
      add({ kind: 'error', level: 'error', message: event.message || 'Uncaught error', source: event.filename, line: event.lineno, col: event.colno, stack: event.error && event.error.stack });
    } catch (_) {}
  });
  const previousOnError = window.onerror;
  window.onerror = function() {
    try {
      const error = arguments[4];
      if (!error || !seenErrors.has(error)) {
        if (error) seenErrors.add(error);
        add({ kind: 'error', level: 'error', message: arguments[0], source: arguments[1], line: arguments[2], col: arguments[3], stack: error && error.stack });
      }
    } catch (_) {}
    try { return typeof previousOnError === 'function' ? previousOnError.apply(this, arguments) : false; } catch (_) { return false; }
  };
  window.addEventListener('unhandledrejection', event => {
    try {
      const reason = event.reason;
      add({ kind: 'rejection', level: 'error', message: reason && reason.message || reason, stack: reason && reason.stack });
    } catch (_) {}
  });
  const nativeFetch = window.fetch;
  if (nativeFetch) window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input && input.url || String(input);
    if (isReport(url)) return nativeFetch.apply(this, arguments);
    const method = String(init && init.method || input && input.method || 'GET').toUpperCase();
    const started = performance.now();
    const requestBody = typeof (init && init.body) === 'string' ? init.body : '';
    try {
      const response = await nativeFetch.apply(this, arguments);
      if (failedStatus(response.status)) add({ kind: 'network', level: 'error', message: 'HTTP ' + response.status + ' ' + method + ' ' + url,
        method, url, status: response.status, durationMs: performance.now() - started, requestBody, responseBody: await excerpt(response) });
      return response;
    } catch (error) {
      add({ kind: 'network', level: 'error', message: error && error.message || 'Network request failed', stack: error && error.stack,
        method, url, durationMs: performance.now() - started, requestBody });
      throw error;
    }
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__ormiInspect = { method: String(method).toUpperCase(), url: String(url) };
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const meta = this.__ormiInspect;
    if (!meta || isReport(meta.url)) return xhrSend.apply(this, arguments);
    const started = performance.now();
    const requestBody = typeof body === 'string' ? body : '';
    const record = (message) => {
      let responseBody = '';
      try { if (/^(text\/|application\/(json|xml))/.test(this.getResponseHeader('content-type') || '') && this.responseType !== 'blob' && this.responseType !== 'arraybuffer') responseBody = this.responseText.slice(0, 2048); } catch (_) {}
      add({ kind: 'network', level: 'error', message, method: meta.method, url: meta.url,
        status: this.status || undefined, durationMs: performance.now() - started, requestBody, responseBody });
    };
    this.addEventListener('load', () => { if (failedStatus(this.status)) record('HTTP ' + this.status + ' ' + meta.method + ' ' + meta.url); }, { once: true });
    this.addEventListener('error', () => record('Network request failed: ' + meta.method + ' ' + meta.url), { once: true });
    this.addEventListener('timeout', () => record('Request timed out: ' + meta.method + ' ' + meta.url), { once: true });
    return xhrSend.apply(this, arguments);
  };
  const makeInfo = (element) => {
    try {
      if (!(element instanceof Element)) return null;
      const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1; } catch (_) { return false; } };
      const selector = buildSelector(element, unique);
      const rect = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      const keys = ['display','position','width','height','margin','padding','color','background-color','font-size','font-weight','font-family','border-radius','gap'];
      const styles = {}; for (const key of keys) styles[key] = computed.getPropertyValue(key);
      let component; let source;
      for (let node = element; node && !component; node = node.parentElement) {
        const fiberKey = Object.keys(node).find(key => key.indexOf('__reactFiber$') === 0);
        if (fiberKey) {
          for (let fiber = node[fiberKey]; fiber && !component; fiber = fiber.return) {
            const type = fiber.elementType || fiber.type;
            if (typeof type === 'function') component = type.displayName || type.name;
            if (!source && fiber._debugSource) source = fiber._debugSource.fileName + ':' + fiber._debugSource.lineNumber + ':' + fiber._debugSource.columnNumber;
            if (!source && fiber._debugStack) source = sourceFrame(fiber._debugStack.stack || fiber._debugStack);
          }
        }
        const vue = node.__vueParentComponent;
        if (vue) {
          const type = vue.type || {};
          component = component || type.__name || type.name;
          source = source || type.__file;
        }
      }
      const html = element.outerHTML || '';
      return { url: location.href, selector, html: cap(html, 4096), text: cap(element.innerText || element.textContent || '', 300),
        styles, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, devicePixelRatio: devicePixelRatio },
        ...(component ? { component: cap(component, 200) } : {}), ...(source ? { source: cap(String(source).replace(/\?t=[^:]+/g, ''), 2048) } : {}) };
    } catch (_) { return null; }
  };
  let picker;
  const host = document.createElement('div');
  host.setAttribute('data-ormi-inspector', '');
  Object.assign(host.style, { position:'fixed', inset:'0', zIndex:'2147483647', pointerEvents:'none' });
  const shadow = host.attachShadow({ mode:'open' });
  const root = document.createElement('div');
  const style = document.createElement('style');
  style.textContent = ':host{all:initial} .box{position:fixed;border:2px solid #e2463a;background:rgba(226,70,58,.12);box-sizing:border-box} .label{position:fixed;background:#242424;color:#f2f2f2;font:12px monospace;padding:3px 5px;border-radius:4px;white-space:nowrap}';
  shadow.append(style, root);
  const draw = (element) => {
    try {
      root.replaceChildren();
      if (!element) return;
      const r = element.getBoundingClientRect();
      const box = document.createElement('div'); box.className='box';
      Object.assign(box.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
      const label = document.createElement('div'); label.className='label';
      label.textContent = element.tagName.toLowerCase() + (element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).slice(0,2).join('.') : '') + ' · ' + Math.round(r.width) + '×' + Math.round(r.height);
      Object.assign(label.style,{left:Math.max(0,r.x)+'px',top:Math.max(0,r.y-24)+'px'});
      root.append(box,label);
    } catch (_) {}
  };
  const stopPick = () => {
    try {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    } catch (_) {}
  };
  const cancel = () => { try { if (!picker) return; stopPick(); const current=picker; picker=null; host.remove(); current.resolve([]); } catch (_) {} };
  const finish = () => { try { if (!picker) return; stopPick(); const current=picker; picker=null; host.remove(); current.resolve(current.items); } catch (_) {} };
  const inspectAt = (x,y) => { try { return makeInfo(document.elementFromPoint(x,y)); } catch (_) { return null; } };
  const onMove = event => { try { if (picker) { picker.hover = event.target; draw(event.target); } } catch (_) {} };
  const onClick = event => {
    try {
      if (!picker || event.composedPath().includes(host)) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      const info = makeInfo(event.target); if (!info) return;
      if (!picker.multi) { picker.items=[info]; finish(); return; }
      if (picker.items.length && !event.ctrlKey && !event.metaKey) { finish(); return; }
      if (!picker.items.some(item => item.selector === info.selector && item.url === info.url)) picker.items.push(info);
      draw(event.target);
    } catch (_) {}
  };
  const onKey = event => {
    try {
      if (!picker) return;
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      else if (event.key === 'Enter' && picker.items.length) { event.preventDefault(); finish(); }
    } catch (_) {}
  };
  const pick = (options) => new Promise(resolve => {
    try {
      if (picker) cancel();
      picker = { multi: !!(options && options.multi), items: [], resolve };
      if (!host.isConnected) document.documentElement.append(host);
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    } catch (_) { picker = null; host.remove(); resolve([]); }
  });
  const api = { pick, inspectAt, cancel };
  Object.defineProperty(window, '__ormiPreview', { value: api, configurable: true });
  window.addEventListener('pagehide', () => void flush(true));
  window.setInterval(() => void flush(false), 500);
  } catch (_) {}
})();`;

interface RateWindow { started: number; count: number }
export class PreviewInspector {
  private readonly entries = new Map<string, PreviewConsoleEntry[]>();
  private readonly sequences = new Map<string, number>();
  private readonly dropped = new Map<string, number>();
  private readonly rates = new Map<string, RateWindow>();

  report(session: string, port: number, payload: unknown, now = Date.now()): { accepted: number; dropped: number } {
    if (!payload || typeof payload !== 'object') return { accepted: 0, dropped: 0 };
    const body = payload as { path?: unknown; entries?: unknown };
    if (!Array.isArray(body.entries) || body.entries.length > 50) return { accepted: 0, dropped: 0 };
    const key = session;
    const target = `${session}:${port}`;
    const window = this.rates.get(target);
    const rate = !window || now - window.started >= 1000 ? { started: now, count: 0 } : window;
    this.rates.set(target, rate);
    const allowed = Math.max(0, 200 - rate.count);
    const accepted = Math.min(allowed, body.entries.length);
    const dropped = body.entries.length - accepted;
    rate.count += accepted;
    this.dropped.set(key, (this.dropped.get(key) ?? 0) + dropped);
    let list = this.entries.get(key);
    if (!list) { list = []; this.entries.set(key, list); }
    let seq = this.sequences.get(key) ?? 0;
    for (const value of body.entries.slice(0, accepted)) {
      const entry = this.normalize(value as IncomingEntry, session, port, body.path, ++seq);
      if (entry) list.push(entry);
      else this.dropped.set(key, (this.dropped.get(key) ?? 0) + 1);
    }
    this.sequences.set(key, seq);
    if (list.length > 500) list.splice(0, list.length - 500);
    return { accepted, dropped };
  }

  list(session: string, after?: number, limit = 100): { entries: PreviewConsoleEntry[]; next: number; dropped: number } {
    const stored = this.entries.get(session) ?? [];
    const entries = after === undefined ? stored.slice(-limit) : stored.filter(entry => entry.seq > after).slice(0, limit);
    return { entries, next: entries.at(-1)?.seq ?? after ?? 0, dropped: this.dropped.get(session) ?? 0 };
  }

  clear(session: string): void { this.entries.delete(session); this.dropped.set(session, 0); }

  forPrompt(session: string, ids: string[]): PreviewConsoleEntry[] {
    const entries = this.entries.get(session) ?? [];
    if (!ids.length) return entries.filter(entry => entry.level === 'error').slice(-10);
    const wanted = new Set(ids);
    return entries.filter(entry => wanted.has(entry.id));
  }

  private normalize(value: IncomingEntry, session: string, port: number, path: unknown, seq: number): PreviewConsoleEntry | undefined {
    const kinds = ['console', 'error', 'rejection', 'network'];
    if (!value || typeof value !== 'object' || !kinds.includes(String(value.kind)) || typeof value.message !== 'string') return;
    const level = value.level === 'warn' ? 'warn' : 'error';
    const entry: PreviewConsoleEntry = {
      id: `pc_${randomUUID()}`, seq, ts: Date.now(), port,
      path: truncateInspectorText(typeof value.path === 'string' ? value.path : typeof path === 'string' ? path : '/', 2048),
      kind: value.kind as PreviewConsoleKind, level,
      message: truncateInspectorText(value.message, 4096),
    };
    for (const key of ['stack', 'source', 'url', 'requestBody', 'responseBody'] as const) {
      if (typeof value[key] === 'string') entry[key] = truncateInspectorText(value[key] as string, key === 'stack' ? 8192 : key.endsWith('Body') ? 2048 : 2048);
    }
    for (const key of ['line', 'col', 'status', 'durationMs'] as const) {
      if (typeof value[key] === 'number' && Number.isFinite(value[key])) entry[key] = Math.max(0, Math.round(value[key] as number));
    }
    if (typeof value.method === 'string') entry.method = truncateInspectorText(value.method, 32);
    return entry;
  }
}
