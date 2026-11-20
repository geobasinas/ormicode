import { createElement, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Frame } from '@ormicode/protocol';
import { usePlatform } from '../../lib/platform.ts';
import { useSession } from '../session/useSession.ts';
import { BrowserControls } from './BrowserControls.tsx';
import { BrowserLogDrawer } from './BrowserLogDrawer.tsx';
import { BrowserAnnotator } from './BrowserAnnotator.tsx';
import { annotationStorageKey, useBrowserInspector } from './useBrowserInspector.ts';
import { usePreviewConsole } from './usePreviewConsole.ts';
import { pushToComposer } from '../../lib/composer-inbox.ts';
import { ChoosePreview, EmptyPreview, RemotePreview, StoppedPreview } from './BrowserNotice.tsx';
import type { BrowserListed, BrowserPage, DevicePreset } from './browser-types.ts';
import { TooltipProvider } from '../../components/ui/tooltip.tsx';

const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; } catch { return fallback; }
};
const projectHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
};

export function BrowserPane({ session }: { session: string }) {
  const platform = usePlatform();
  const { transport, desktop } = platform;
  const details = useSession(session);
  const project = details?.project ?? session;
  const projectId = projectHash(project);
  const pagesKey = `ormi.browser.tabs.${session}`;
  const historyKey = `ormi.browser.history.${projectId}`;
  const [pages, setPages] = useState<BrowserPage[]>(() => readJson(pagesKey, []));
  const [history, setHistory] = useState<string[]>(() => readJson(historyKey, []));
  const [active, setActive] = useState(0);
  const [listed, setListed] = useState<BrowserListed>();
  const [logsService, setLogsService] = useState('');
  const [drawerTab, setDrawerTab] = useState<'logs' | 'console'>();
  const [consoleFilter, setConsoleFilter] = useState<'all' | 'errors' | 'network'>('all');
  const [logs, setLogs] = useState<{ text: string; stream: 'stdout' | 'stderr' }[]>([]);
  const [logsHeight, setLogsHeight] = useState(180);
  const [followLogs, setFollowLogs] = useState(true);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<DevicePreset>('Responsive');
  const [rotated, setRotated] = useState(false);
  const [keepSignins, setKeepSignins] = useState(() => localStorage.getItem(`ormi.browser.signins.${projectId}`) !== 'false');
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busyService, setBusyService] = useState('');
  const [paneSize, setPaneSize] = useState([0, 0]);
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const [snapshot, setSnapshot] = useState('');
  const [readyId, setReadyId] = useState('');
  const [webviewReady, setWebviewReady] = useState(false);
  const webview = useRef<any>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const logsCursor = useRef(0);
  const historyKeyRef = useRef(historyKey);
  const serviceStates = useRef(new Map<number, string>());
  const current = pages[active];
  const inspector = useBrowserInspector(session, webview, current, Boolean(readyId && webviewReady));
  const previewConsole = usePreviewConsole(session);
  const partition = `${keepSignins ? 'persist:' : ''}ormi-preview-${projectId}`;
  const remote = platform.kind !== 'desktop';
  const relayRemote = Boolean(desktop?.remote()?.active);
  const currentService = listed?.services.find(service => service.port === current?.port);
  useEffect(() => { previewConsole.setOpen(drawerTab === 'console'); }, [drawerTab, previewConsole.setOpen]);

  const refresh = async () => {
    const response = await transport.request('service.list', { session });
    if (response.type === 'res') setListed(response.body as unknown as BrowserListed);
  };
  useEffect(() => { void refresh(); }, [session]);
  useEffect(() => {
    const previous = transport.onEvent;
    const listener = (frame: Frame) => {
      previous?.(frame);
      if (frame.type === 'evt' && frame.session === session && (frame.body as Record<string, unknown>).kind === 'service_state') void refresh();
    };
    transport.onEvent = listener;
    return () => { if (transport.onEvent === listener) transport.onEvent = previous; };
  }, [transport, session]);
  useEffect(() => { localStorage.setItem(pagesKey, JSON.stringify(pages)); }, [pagesKey, pages]);
  useEffect(() => {
    if (historyKeyRef.current === historyKey) localStorage.setItem(historyKey, JSON.stringify(history));
  }, [historyKey, history]);
  useEffect(() => { historyKeyRef.current = historyKey; setHistory(readJson(historyKey, [])); }, [historyKey]);
  useEffect(() => { setKeepSignins(localStorage.getItem(`ormi.browser.signins.${projectId}`) !== 'false'); }, [projectId]);
  useEffect(() => {
    const element = paneRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setPaneSize([element.clientWidth, element.clientHeight]));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setAddress(current?.path ?? '');
    setCanBack(false); setCanForward(false); setReadyId(''); setWebviewReady(false);
    setLoading(Boolean(current));
    if (!current) return;
    let alive = true;
    void transport.request('preview.url', { session, port: current.port, path: current.path }).then(response => {
      if (!alive || response.type !== 'res') return;
      const url = (response.body as { url: string }).url;
      setPages(previous => previous.map((page, index) => index === active ? { ...page, url } : page));
      setReadyId(current.id);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active, current?.id, session, transport]);
  useEffect(() => {
    if (!listed) return;
    for (const service of listed.services) {
      const previous = serviceStates.current.get(service.port);
      if (previous !== 'running' && service.state === 'running' && current?.port === service.port) {
        setReadyId(''); setWebviewReady(false);
        const pageId = current.id;
        void transport.request('preview.url', { session, port: service.port, path: current.path }).then(response => {
          if (response.type !== 'res') return;
          const url = (response.body as { url: string }).url;
          setPages(before => before.map(page => page.id === pageId ? { ...page, url } : page));
          setReadyId(pageId);
        });
      }
      serviceStates.current.set(service.port, service.state);
    }
  }, [listed, current?.id, session, transport]);
  useEffect(() => {
    const view = webview.current;
    if (!view || !current || readyId !== current.id) { if (!current) setLoading(false); return; }
    const navigate = (event: any) => {
      const url = new URL(event.url); const path = `${url.pathname}${url.search}${url.hash}`;
      setAddress(path); setCanBack(view.canGoBack()); setCanForward(view.canGoForward());
      setPages(previous => previous.map((page, index) => index === active ? { ...page, path } : page));
      setHistory(previous => [path, ...previous.filter(item => item !== path)].slice(0, 50));
    };
    const navigateInPage = (event: any) => {
      const url = new URL(event.url); const path = `${url.pathname}${url.search}${url.hash}`;
      setAddress(path); setCanBack(view.canGoBack()); setCanForward(view.canGoForward());
      setPages(previous => previous.map((page, index) => index === active ? { ...page, path } : page));
    };
    const titleUpdated = (event: any) => setPages(previous => previous.map((page, index) => index === active ? { ...page, title: event.title } : page));
    const started = () => setLoading(true);
    const stopped = () => { setLoading(false); setCanBack(view.canGoBack()); setCanForward(view.canGoForward()); };
    const domReady = () => { setWebviewReady(true); setLoading(false); };
    view.addEventListener('did-start-loading', started);
    view.addEventListener('did-stop-loading', stopped);
    view.addEventListener('did-navigate', navigate);
    view.addEventListener('did-navigate-in-page', navigateInPage);
    view.addEventListener('page-title-updated', titleUpdated);
    view.addEventListener('dom-ready', domReady);
    setLoading(true);
    return () => {
      view.removeEventListener('did-start-loading', started);
      view.removeEventListener('did-stop-loading', stopped);
      view.removeEventListener('did-navigate', navigate);
      view.removeEventListener('did-navigate-in-page', navigateInPage);
      view.removeEventListener('page-title-updated', titleUpdated);
      view.removeEventListener('dom-ready', domReady);
    };
  }, [active, current?.id, readyId]);
  useEffect(() => {
    const view = webview.current;
    if (!overlaysOpen) { setSnapshot(''); return; }
    setSnapshot('');
    if (!current || readyId !== current.id || !webviewReady || typeof view?.capturePage !== 'function') return;
    let alive = true;
    let capture: Promise<{ toDataURL?: () => string }>;
    try { capture = view.capturePage(); } catch { return; }
    void capture.then((image: { toDataURL?: () => string }) => {
      if (alive && image && typeof image.toDataURL === 'function') setSnapshot(image.toDataURL());
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [overlaysOpen, current?.id, current?.url, device, rotated, readyId, webviewReady]);
  useEffect(() => {
    if (logsService && paneSize[1] > 0) setLogsHeight(Math.max(140, Math.min(500, Math.round(paneSize[1] * 0.35))));
  }, [logsService, paneSize[1]]);
  useEffect(() => {
    if (drawerTab !== 'logs' || !logsService) return;
    let alive = true;
    logsCursor.current = 0;
    setLogs([]);
    const load = async () => {
      const after = logsCursor.current || undefined;
      const response = await transport.request('service.logs', { session, service: logsService, ...(after ? { after } : {}) });
      if (alive && response.type === 'res') {
        const page = response.body as { lines: { text: string; stream: 'stdout' | 'stderr' }[]; next: number };
        setLogs(previous => after ? [...previous, ...page.lines].slice(-2000) : page.lines);
        logsCursor.current = page.next;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [drawerTab, logsService, session, transport]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'c' || !paneRef.current?.contains(document.activeElement)) return;
      event.preventDefault(); void inspector.pick();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [inspector.pick]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (document.querySelector('textarea[aria-label^="Comment "]')) return;
      const overlayOpen = [...document.querySelectorAll('[role="dialog"], [role="menu"]')].some(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return element.getAttribute('data-state') !== 'closed'
          && element.getAttribute('aria-hidden') !== 'true'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      });
      if (overlayOpen) return;
      if (inspector.pickActive) { event.preventDefault(); void inspector.pick(); }
      else if (inspector.frame) { event.preventDefault(); inspector.setFrame(undefined); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [inspector.frame, inspector.pick, inspector.pickActive, inspector.setFrame]);

  const navigate = async (port: number, path: string, title = 'Preview') => {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const response = await transport.request('preview.url', { session, port, path: normalized });
    if (response.type !== 'res') return;
    const url = (response.body as { url: string }).url;
    const page: BrowserPage = { id: `${port}:${Date.now()}`, title, port, path: normalized, url };
    setPages(previous => [...previous, page]);
    setActive(pages.length);
    setHistory(previous => [normalized, ...previous.filter(item => item !== normalized)].slice(0, 50));
  };
  const navigateCurrent = async (port: number, path: string) => {
    if (!current || current.port !== port) return navigate(port, path);
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const response = await transport.request('preview.url', { session, port, path: normalized });
    if (response.type !== 'res') return;
    webview.current?.loadURL((response.body as { url: string }).url);
    setPages(previous => previous.map((page, index) => index === active ? { ...page, path: normalized } : page));
    setHistory(previous => [normalized, ...previous.filter(item => item !== normalized)].slice(0, 50));
  };
  const openPortal = (port: number, path: string, title: string) => void navigate(port, path, title);
  const addressSubmit = async () => {
    if (!current) return;
    if (/^https?:\/\//i.test(address)) {
      try {
        const parsed = new URL(address);
        const port = Number(parsed.port);
        if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && listed
          && port >= listed.ports.base && port < listed.ports.base + listed.ports.count) {
          await navigateCurrent(port, `${parsed.pathname}${parsed.search}${parsed.hash}`);
          return;
        }
      } catch { /* Open non-preview URLs externally. */ }
      void desktop?.openExternal(address);
      return;
    }
    await navigateCurrent(current.port, address.startsWith('/') ? address : `/${address}`);
  };
  const serviceAction = async (action: 'service.start' | 'service.stop' | 'service.restart', name: string) => {
    if (busyService) return;
    setBusyService(name); setActionError('');
    try {
      const response = await transport.request(action, { session, service: name });
      if (response.type === 'err') setActionError(response.message);
      else await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally { setBusyService(''); }
  };
  const serviceActionAll = async (action: 'service.start' | 'service.stop') => {
    const targets = listed?.services.filter(service => action === 'service.start'
      ? service.state !== 'running' && service.state !== 'starting'
      : ['running', 'starting', 'unhealthy'].includes(service.state)) ?? [];
    for (const service of targets) await serviceAction(action, service.name);
  };
  const openExternalCurrent = async () => {
    if (!current) return;
    const response = await transport.request('preview.url', { session, port: current.port, path: current.path });
    if (response.type === 'res') void desktop?.openExternal((response.body as { url: string }).url);
  };
  const clearBrowsingData = () => {
    if (window.confirm('Clear preview browsing data?')) void desktop?.previewClearData(partition);
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = { y: event.clientY, height: logsHeight };
    const move = (next: PointerEvent) => setLogsHeight(Math.max(100, Math.min(500, start.height + start.y - next.clientY)));
    const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', done);
  };
  const openLogs = (service: string) => { setLogsService(service); setDrawerTab('logs'); };
  const addConsoleEntry = (entry: { id: string }) => pushToComposer(session, { context: [{ kind: 'console', console: { ids: [entry.id] } }] });
  const sendConsoleEntry = (entry: { id: string }) => pushToComposer(session, {
    text: 'Fix this error from the preview:', context: [{ kind: 'console', console: { ids: [entry.id] } }], send: true,
  });

  const dimensions = device === 'Phone' ? [390, 844] : device === 'Tablet' ? [820, 1180] : device === 'Desktop' ? [1440, 900] : undefined;
  const deviceSize = dimensions ? [rotated ? dimensions[1] : dimensions[0], rotated ? dimensions[0] : dimensions[1]] : undefined;
  const scale = deviceSize && paneSize[0] > 0 && paneSize[1] > 0
    ? Math.max(0, Math.min(1, (paneSize[0] - 34) / deviceSize[0], (paneSize[1] - 40) / deviceSize[1])) : 1;
  const currentStopped = currentService?.state === 'stopped' || currentService?.state === 'starting' ? currentService : undefined;
  const displayedStopped = currentStopped ?? (!current ? listed?.services.find(service => service.state === 'stopped' || service.state === 'starting') : undefined);
  const snapshotVisible = overlaysOpen && Boolean(snapshot);
  const renderWebview = (style: Record<string, unknown>) => readyId === current?.id
    ? <>
      {createElement('webview' as any, {
        key: `${current.id}:${partition}:${current.url}`, ref: webview, src: current.url, partition,
        style: { background: 'var(--bg-main)', visibility: snapshotVisible || Boolean(inspector.frame) ? 'hidden' : 'visible', ...style },
      })}
      {snapshotVisible ? <img src={snapshot} alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }} /> : null}
      {inspector.frame && current ? <BrowserAnnotator key={current.id} frame={inspector.frame} storageKey={annotationStorageKey(session, current.id)}
        onSubmit={inspector.submitAnnotations} onDiscard={() => inspector.setFrame(undefined)} /> : null}
    </>
    : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-hint)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11 }}><span className="ormi-browser-spinner" />Loading preview…</span>
    </div>;

  return <TooltipProvider delayDuration={250}><div style={{ height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', color: 'var(--text-label)' }}>
    {!remote ? <BrowserControls
      pages={pages} active={active} listed={listed} current={current} canBack={canBack} canForward={canForward} loading={loading}
      address={address} history={history} device={device} fixed={Boolean(deviceSize)}
      busyService={busyService} actionError={actionError} keepSignins={keepSignins}
      onSelectPage={setActive} onClosePage={index => {
        const next = pages.filter((_, pageIndex) => pageIndex !== index);
        setPages(next);
        setActive(Math.max(0, Math.min(index === active ? Math.max(0, active - 1) : active - (index < active ? 1 : 0), next.length - 1)));
      }}
      onOpenPortal={openPortal} onBack={() => webview.current?.goBack()} onForward={() => webview.current?.goForward()}
      onReload={() => webview.current?.reload()} onAddressChange={setAddress} onAddressSubmit={() => void addressSubmit()}
      pickActive={inspector.pickActive} annotateActive={Boolean(inspector.frame)}
      consoleUnread={previewConsole.unread} consoleErrors={previewConsole.unreadErrors} onPick={() => void inspector.pick()}
      onAnnotate={() => void inspector.annotate()} onConsole={() => setDrawerTab('console')}
      onDeviceChange={setDevice} onRotate={() => setRotated(value => !value)} onRefresh={() => void refresh()}
      onServiceAction={(action, name) => void serviceAction(action, name)} onServiceAll={action => void serviceActionAll(action)} onLogs={openLogs}
      onOpenExternal={() => void openExternalCurrent()} onKeepSigninsChange={value => {
        setKeepSignins(value); localStorage.setItem(`ormi.browser.signins.${projectId}`, String(value));
      }} onClearBrowsingData={clearBrowsingData} onOverlayOpenChange={setOverlaysOpen}
    /> : null}
    {relayRemote ? <div role="status" style={{ padding: '5px 10px', borderBottom: '1px solid var(--line-subtle)', background: 'var(--bg-raised)', color: 'var(--text-hint)', fontSize: 10.5 }}>Live reload isn't available over the relay; use Reload.</div> : null}
    {inspector.hint && !remote ? <div role="status" style={{ padding: '5px 10px', borderBottom: '1px solid var(--line-subtle)', background: 'var(--bg-raised)', color: 'var(--text-hint)', fontSize: 10.5 }}>{inspector.hint}</div> : null}
    {remote ? <main style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-inset)' }}><RemotePreview /></main>
      : <main ref={paneRef} style={{
        position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        background: deviceSize ? 'var(--bg-inset)' : 'var(--bg-main)',
      }}>
        {current && displayedStopped ? <StoppedPreview service={displayedStopped} starting={displayedStopped.state === 'starting'} onStart={() => void serviceAction('service.start', displayedStopped.name)} />
          : current ? deviceSize
            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '100%', maxHeight: '100%' }}>
              <div style={{ position: 'relative', width: deviceSize[0] * scale + 2, height: deviceSize[1] * scale + 2, flexShrink: 1, border: '1px solid var(--line-card)', borderRadius: 16, overflow: 'hidden', background: 'var(--bg-main)', boxShadow: '0 10px 28px var(--shadow-color)' }}>
                <div style={{ position: 'absolute', inset: 1, overflow: 'hidden', borderRadius: 15 }}>
                  {renderWebview({ position: 'absolute', inset: 0, width: `${deviceSize[0]}px`, height: `${deviceSize[1]}px`, transform: `scale(${scale})`, transformOrigin: 'top left' })}
                </div>
              </div>
              <span style={{ paddingTop: 6, color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                {deviceSize[0]} × {deviceSize[1]} · {Math.round(scale * 100)}%
              </span>
            </div>
            : <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {renderWebview({ position: 'absolute', inset: 0, width: '100%', height: '100%' })}
            </div>
          : !listed || (!listed.services.length && !listed.detected.length) ? (listed ? <EmptyPreview listed={listed} /> : null)
            : displayedStopped ? <StoppedPreview service={displayedStopped} starting={displayedStopped.state === 'starting'} onStart={() => void serviceAction('service.start', displayedStopped.name)} />
              : <ChoosePreview listed={listed} onOpenPortal={openPortal} />}
      </main>}
    {drawerTab && !remote ? <>
      <div role="separator" aria-orientation="horizontal" aria-label="Resize service logs" className="ormi-handle ormi-handle-horizontal"
        onPointerDown={startResize} style={{ height: 6, width: 'auto', flexShrink: 0, cursor: 'ns-resize', touchAction: 'none' }} />
      <BrowserLogDrawer tab={drawerTab} unread={previewConsole.unread} unreadErrors={previewConsole.unreadErrors} entries={previewConsole.entries} dropped={previewConsole.dropped}
        filter={consoleFilter} onTabChange={setDrawerTab} onFilterChange={setConsoleFilter}
        onConsoleClear={() => void previewConsole.clear()} onConsoleAdd={addConsoleEntry} onConsoleSend={sendConsoleEntry}
        service={logsService} services={listed?.services.map(service => service.name) ?? (logsService ? [logsService] : [])} lines={logs}
        height={logsHeight} follow={followLogs} onServiceChange={setLogsService} onFollowChange={setFollowLogs}
        onClear={() => setLogs([])} onClose={() => setDrawerTab(undefined)} onScroll={setFollowLogs} />
    </> : null}
  </div></TooltipProvider>;
}
