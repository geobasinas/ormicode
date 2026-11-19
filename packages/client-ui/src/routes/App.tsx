/** App shell: custom titlebar (frameless window), sidebar with search /
 * new-session / All|Sessions|Bots filter / grouped session list, and the
 * pinned Now tab + session tabs from the layout descriptor. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlatform } from '@ormicode/client-platform';
import { PlatformContext } from '../lib/platform.ts';
import { applyTheme, themeByName } from '../lib/theme.ts';
import { defaultLayout, applyLayout, validateLayout } from '../lib/layout.ts';
import type { LayoutDescriptor } from '../lib/layout.ts';
import { PanelLeft, Minus, Square, X, Search, SquarePen, Settings, GitBranch, FolderOpen, SquareTerminal, NotebookPen, Globe, PenTool, type LucideIcon } from 'lucide-react';
import { SessionList } from '../features/session/SessionList.tsx';
import { useSession } from '../features/session/useSession.ts';
import { Now } from './Now.tsx';
import { SessionView } from './SessionView.tsx';
import { DesignPage } from './DesignPage.tsx';
import { OPEN_FILE } from '../lib/openFile.ts';
import { SettingsView, loadPrefs, type Prefs } from './Settings.tsx';
import { SessionHeader } from '../features/session/SessionHeader.tsx';
import { NEEDS_YOU } from '../features/session/state.tsx';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { Toaster } from '../components/ui/sonner.tsx';
import { WorkspaceSwitcher, type Workspace } from './WorkspaceSwitcher.tsx';
import { codeWorkspaceRoute } from '../lib/workspace-route.ts';

const MAX_TABS = 8;
const drag = { WebkitAppRegion: 'drag' } as const;
const noDrag = { WebkitAppRegion: 'no-drag' } as const;

function Titlebar({ platform, workspace, onWorkspaceChange, sidebarOpen, onSidebarToggle }: {
  platform: ClientPlatform; workspace: Workspace; onWorkspaceChange(workspace: Workspace): void; sidebarOpen: boolean; onSidebarToggle(): void;
}) {
  const d = platform.desktop;
  const btn = { ...noDrag, width: 46, height: 40, font: 'inherit', fontSize: 13, border: 'none', cursor: 'default', background: 'transparent', color: 'var(--text-secondary)' };
  return (
    <div style={{ ...drag, height: 40, display: 'flex', alignItems: 'center', paddingLeft: 14, background: 'var(--bg-window)', flexShrink: 0 }}>
      <button type="button" className="hv" title="Toggle sidebar" aria-label="Toggle sidebar" aria-expanded={sidebarOpen} onClick={onSidebarToggle}
        style={{ ...noDrag, display: 'grid', placeItems: 'center', padding: 4, borderRadius: 5, marginLeft: -4, marginRight: -4, color: 'var(--text-secondary)' }}><PanelLeft size={15} /></button>
      <WorkspaceSwitcher workspace={workspace} onChange={onWorkspaceChange} />
      <span style={{ flex: 1 }} />
      {d ? (
        <span style={{ display: 'flex' }}>
          <button className="hv" style={btn} onClick={() => d.winMin()} title="Minimize"><Minus size={15} style={{ display: 'block', margin: 'auto' }} /></button>
          <button className="hv" style={btn} onClick={() => d.winMax()} title="Maximize"><Square size={13} style={{ display: 'block', margin: 'auto' }} /></button>
          <button className="hv hv-close" style={btn} onClick={() => d.winClose()} title="Close"><X size={16} style={{ display: 'block', margin: 'auto' }} /></button>
        </span>
      ) : null}
    </div>
  );
}

const PAGES: Record<string, string> = { now: 'Home', settings: 'Settings', design: 'Design' };

function Tab({ id, n, active, onSelect, onClose }: { id: string; n?: number; active: boolean; onSelect: () => void; onClose?: () => void }) {
  const details = useSession(PAGES[id] ? undefined : id);
  const label = PAGES[id] ?? (details?.title || id.slice(0, 14));
  const needsYou = !!details && NEEDS_YOU.has(details.state);
  const R = 10;
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.minWidth = ''; el.style.minWidth = `${Math.ceil(el.getBoundingClientRect().width)}px`; } }, [label, active, onClose]);
  const fillet = (side: 'left' | 'right') => (
    <svg aria-hidden width={R} height={R} viewBox={`0 0 ${R} ${R}`} style={{ position: 'absolute', bottom: 0, [side === 'right' ? 'left' : 'right']: '100%', pointerEvents: 'none', display: 'block' }}>
      <path fill="var(--bg-main)" d={side === 'right' ? `M0 0V${R}H${R}A${R} ${R} 0 0 1 0 0Z` : `M${R} 0V${R}H0A${R} ${R} 0 0 0 ${R} 0Z`} />
    </svg>
  );
  return (
    <span ref={ref} style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: active ? 600 : 400,
      padding: '2px 0 4px', borderRadius: `${R}px ${R}px 0 0`, cursor: 'pointer', whiteSpace: 'nowrap',
      background: active ? 'var(--bg-main)' : 'transparent',
      color: active ? 'var(--text-active)' : 'var(--text-secondary)',
    }} onClick={onSelect}>
      <span className={active ? undefined : 'hv-tab'} style={{ position: 'relative', zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 11px', borderRadius: 8 }}>
        {n !== undefined ? <span style={{ width: 18, height: 18, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: needsYou ? 'var(--tint-amber)' : 'var(--bg-chip)', color: needsYou ? 'var(--accent-amber)' : 'var(--text-label)', fontSize: 10, fontWeight: 700 }}>{n}</span> : null}
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {active && details?.project !== 'scratch' && details?.branch ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 400, color: 'var(--text-secondary)' }}><GitBranch size={10} />{details.branch}</span> : null}
        {onClose ? <X size={12} className="hv-x" style={{ color: 'var(--text-hint)', borderRadius: 4 }} onClick={e => { e.stopPropagation(); onClose(); }} /> : null}
      </span>
      {active ? fillet('right') : null}
      {active && id !== 'now' ? fillet('left') : null}
    </span>
  );
}

const FILTER_TABS = ['All', 'Sessions', 'Bots'] as const;

const RAIL_ICONS: { id: string; icon: LucideIcon; label: string; soon?: boolean }[] = [
  { id: 'git', icon: GitBranch, label: 'git' },
  { id: 'files', icon: FolderOpen, label: 'files' },
  { id: 'terminal', icon: SquareTerminal, label: 'terminal' },
  { id: 'notes', icon: NotebookPen, label: 'notes' },
  { id: 'browser', icon: Globe, label: 'browser' },
  { id: 'design', icon: PenTool, label: 'design' },
];

export type RailPane = 'none' | 'notes' | 'git' | 'terminal' | 'files' | 'browser';
const PANES: string[] = ['notes', 'git', 'terminal', 'files', 'browser', 'design'];

function Rail({ route, rail, onRail, onDesign }: { route: string; rail: RailPane; onRail: (r: RailPane) => void; onDesign(): void }) {
  const isSession = !PAGES[route];
  const details = useSession(isSession && route !== 'settings' ? route : undefined);
  return (
    <div style={{
      width: 46, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '12px 0 0', gap: 4, background: 'var(--bg-window)', alignSelf: 'flex-start',
    }}>
      {RAIL_ICONS.filter(item => !(details?.project === 'scratch' && item.id === 'git')).map(({ id, icon: Icon, label, soon }) => {
        const enabled = id === 'design' || (PANES.includes(id) ? isSession : !soon);
        const active = id === 'design' ? route === 'design' : isSession && id === rail;
        return (
          <button key={id} className={enabled && !active ? 'hv' : undefined} title={enabled ? label : `${label} — soon`} aria-disabled={!enabled}
            onClick={() => id === 'design' ? onDesign() : enabled && PANES.includes(id) && onRail(rail === id ? 'none' : id as RailPane)}
            style={{
              width: 32, height: 32, border: 'none', borderRadius: 8, cursor: enabled ? 'pointer' : 'default',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: active ? 'var(--bg-selected)' : 'transparent',
              color: active ? 'var(--text-active)' : 'var(--text-hint)',
            }}><Icon size={16} /></button>
        );
      })}
    </div>
  );
}

function ActiveHeader({ session, onOpen, onHandoff }: { session: string; onOpen: (session: string) => void; onHandoff(): void }) {
  const details = useSession(session);
  return <SessionHeader session={session} details={details} onOpen={onOpen} onHandoff={onHandoff} />;
}

export function App({ platform, theme: initialTheme, layout }: { platform: ClientPlatform; theme?: string; layout?: LayoutDescriptor }) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(initialTheme));
  const theme = prefs.theme;
  const [storedLayout, setStoredLayout] = useState<LayoutDescriptor>(() => {
    if (layout) return layout;
    try { return JSON.parse(globalThis.localStorage?.getItem('ormi.layout') ?? 'null') ?? defaultLayout; } catch { return defaultLayout; }
  });
  const [tabs, setTabs] = useState<string[]>([]);
  const [route, setRoute] = useState<string>('now');
  const [designSession, setDesignSession] = useState<string>();
  const [designSidebarOpen, setDesignSidebarOpen] = useState(() => !window.matchMedia('(max-width: 850px)').matches);
  const [codeSidebarOverride, setCodeSidebarOverride] = useState<boolean>();
  const lastCodeRoute = useRef('now');
  useEffect(() => { if (route !== 'design' && route !== 'settings') lastCodeRoute.current = route; }, [route]);
  const [toastBottomOffset, setToastBottomOffset] = useState(16);
  const [state, setState] = useState<string>('connecting');
  const [query, setQuery] = useState('');
  const [rail, setRail] = useState<RailPane>(() => storedLayout.regions.rightRail?.collapsed === false ? 'files' : 'none');
  const [handoffOpen, setHandoffOpen] = useState(false);
  useLayoutEffect(() => {
    if (PAGES[route]) {
      setToastBottomOffset(16);
      return;
    }
    const composer = document.querySelector<HTMLElement>('[data-session-composer]');
    if (!composer) {
      setToastBottomOffset(16);
      return;
    }
    const update = () => {
      const desired = window.innerHeight - composer.getBoundingClientRect().top + 8;
      const maximum = Math.max(16, window.innerHeight - 64);
      setToastBottomOffset(Math.min(Math.max(16, desired), maximum));
    };
    const observer = new ResizeObserver(update);
    observer.observe(composer);
    if (composer.parentElement) observer.observe(composer.parentElement);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [route]);
  useEffect(() => {
    const on = () => setRail('files');
    window.addEventListener(OPEN_FILE, on);
    return () => window.removeEventListener(OPEN_FILE, on);
  }, []);
  const [filter, setFilter] = useState<(typeof FILTER_TABS)[number]>('All');
  const resolved = useMemo(() => {
    const v = validateLayout(storedLayout);
    return v.ok ? applyLayout(defaultLayout, storedLayout, prefs.safeMode) : defaultLayout;
  }, [storedLayout, prefs.safeMode]);
  const layoutWriteTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (resolved.regions.rightRail?.collapsed !== false) setRail('none');
    else setRail(current => current === 'none' ? 'files' : current);
  }, [resolved.regions.rightRail?.collapsed]);
  useEffect(() => {
    const update = (event: Event) => {
      const descriptor = (event as CustomEvent<LayoutDescriptor>).detail;
      if (!descriptor) return;
      setStoredLayout(descriptor);
      window.clearTimeout(layoutWriteTimer.current);
      layoutWriteTimer.current = window.setTimeout(() => {
        if (platform.desktop) void platform.desktop.layoutWrite(descriptor).catch(() => undefined);
        else try { globalThis.localStorage?.setItem('ormi.layout', JSON.stringify(descriptor)); } catch { /* private mode */ }
      }, 300);
    };
    window.addEventListener('ormi-layout-change', update);
    return () => {
      window.removeEventListener('ormi-layout-change', update);
      window.clearTimeout(layoutWriteTimer.current);
    };
  }, [platform]);

  useEffect(() => { applyTheme(themeByName(theme)); }, [theme]);
  const searchRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (route === 'design' && e.key !== ',') return;
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setRoute('now'); }
      if (e.key === '1') { e.preventDefault(); setRoute('now'); }
      if (e.key === ',') { e.preventDefault(); openRef.current('settings'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef, route]);
  useEffect(() => {
    platform.transport.onState = setState;
    platform.transport.onState?.(state);
  }, [platform]);

  const sidebar = resolved.regions.sidebar;
  const codeSidebarOpen = codeSidebarOverride ?? (sidebar?.visible !== false && sidebar?.collapsed !== true);
  const inDesign = route === 'design';
  const openRef = useRef((id: string) => { void id; });
  const shellLayout = useDefaultLayout({ id: 'ormi.shell', storage: globalThis.localStorage });
  const onShellLayoutChanged: typeof shellLayout.onLayoutChanged = (panelLayout, meta) => {
    shellLayout.onLayoutChanged(panelLayout, meta);
    if (!meta.isUserInteraction) return;
    const width = panelLayout.sidebar;
    if (typeof width !== 'number' || !Number.isFinite(width)) return;
    const size = Math.round(width * Math.max(0, window.innerWidth - 46) / 100);
    if (Math.abs(size - (sidebar?.size ?? 268)) < 2) return;
    const descriptor: LayoutDescriptor = {
      ...resolved, source: 'user',
      regions: { ...resolved.regions, sidebar: { ...sidebar, order: sidebar?.order ?? 0, size } },
    };
    window.dispatchEvent(new CustomEvent('ormi-layout-change', { detail: descriptor }));
  };
  const open = (id: string) => {
    if (!PAGES[id]) setDesignSession(id);
    if (id === 'design') { if (!PAGES[route]) setDesignSession(route); setRoute(id); return; }
    setTabs(ts => ts.includes(id) ? ts : [...ts.slice(-(MAX_TABS - 1)), id]);
    setRoute(id);
  };
  openRef.current = id => open(id);
  const close = (id: string) => setTabs(ts => {
    const next = ts.filter(t => t !== id);
    if (route === id) setRoute(next[next.length - 1] ?? 'now');
    return next;
  });

  return (
    <PlatformContext.Provider value={platform}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-window)', color: 'var(--text-label)', fontFamily: 'var(--font-ui)', fontSize: 14, borderRadius: 14, overflow: 'hidden' }}>
        <Titlebar platform={platform} workspace={inDesign ? 'design' : 'code'} onWorkspaceChange={workspace => workspace === 'design' ? open('design') : setRoute(codeWorkspaceRoute(lastCodeRoute.current, tabs))}
          sidebarOpen={inDesign ? designSidebarOpen : codeSidebarOpen} onSidebarToggle={() => inDesign ? setDesignSidebarOpen(value => !value) : setCodeSidebarOverride(!codeSidebarOpen)} />
        {inDesign ? <DesignPage initialSession={designSession} onSessionChange={setDesignSession} onOpen={open} sidebarOpen={designSidebarOpen} onShowSidebar={() => setDesignSidebarOpen(true)} /> : <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Group id="ormi.shell" orientation="horizontal" defaultLayout={shellLayout.defaultLayout} onLayoutChanged={onShellLayoutChanged} style={{ flex: 1, minWidth: 0 }}>
          {codeSidebarOpen ? <>
            <Panel id="sidebar" defaultSize={sidebar?.size ?? 268} minSize={220} maxSize={420}>
            <aside style={{
              width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
              gap: 1, padding: '12px 8px 6px', background: 'var(--bg-window)',
            }}>
              <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--line-divider)' }}>
                <Search size={15} style={{ color: 'var(--text-label)', flexShrink: 0 }} />
                <input ref={el => { searchRef.current = el; }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
                  style={{ flex: 1, minWidth: 0, font: 'inherit', fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-label)' }} />
                <span style={{ fontSize: 10, color: 'var(--text-hint)', whiteSpace: 'nowrap' }}>Ctrl K</span>
              </div>
              <button className="hv-sub" onClick={() => setRoute('now')} style={{
                height: 30, marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px',
                font: 'inherit', fontSize: 13, cursor: 'pointer', background: 'transparent', border: 'none',
                borderRadius: 8, color: 'var(--text-title)', textAlign: 'left',
              }}>
                <SquarePen size={15} style={{ color: 'var(--text-title)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>New session</span>
                <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>Ctrl N</span>
              </button>
              <div style={{ height: 4 }} />
              <div style={{ display: 'flex', padding: '0 2px' }}>
                <div style={{ flex: 1, display: 'flex', gap: 2, padding: 2, background: 'var(--bg-inset)', borderRadius: 9 }}>
                  {FILTER_TABS.map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{
                      flex: 1, font: 'inherit', fontSize: 12, fontWeight: filter === f ? 500 : 400, cursor: 'pointer',
                      padding: '4px 0', border: 'none', borderRadius: 7, textAlign: 'center',
                      background: filter === f ? 'var(--bg-selected)' : 'transparent',
                      color: filter === f ? 'var(--text-active)' : 'var(--text-secondary)',
                    }}>{f}</button>
                  ))}
                </div>
              </div>
              <div style={{ height: 8 }} />
              <div style={{ flex: 1, overflow: 'auto' }}>
                {filter !== 'Bots' ? <SessionList active={route !== 'now' ? route : undefined} onSelect={open} query={query} /> : (
                  <div style={{ padding: '0 var(--space-3)', color: 'var(--text-hint)', fontSize: 13 }}>no bots yet</div>
                )}
              </div>
              <button className="hv-sub" onClick={() => open('settings')} style={{
                height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', marginTop: 4,
                font: 'inherit', cursor: 'pointer', border: 'none', borderRadius: 8, textAlign: 'left',
                background: route === 'settings' ? 'var(--bg-selected)' : 'transparent',
              }}>
                <Settings size={15} style={{ color: route === 'settings' ? 'var(--text-active)' : 'var(--text-label)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: route === 'settings' ? 'var(--text-active)' : 'var(--text-label)' }}>Settings</span>
              </button>
            </aside>
            </Panel>
            <Separator className="ormi-handle" />
          </> : null}
          <Panel id="main" minSize={420}>
          <main style={{ height: '100%', boxSizing: 'border-box', minWidth: 0, display: 'flex', flexDirection: 'column', padding: '12px 0 18px 12px' }}>
            <div style={{ display: 'flex', gap: 10, flexShrink: 0, position: 'relative', zIndex: 1, marginBottom: -1 }}>
              <Tab id="now" active={route === 'now'} onSelect={() => setRoute('now')} />
              {tabs.map((t, i) => <Tab key={t} id={t} n={PAGES[t] ? undefined : tabs.filter(x => !PAGES[x]).indexOf(t) + 1} active={route === t} onSelect={() => setRoute(t)} onClose={() => close(t)} />)}
              <span style={{ flex: 1 }} />
              {!PAGES[route] ? <div style={{ ...noDrag, minWidth: 0, display: 'flex' }}><ActiveHeader key={route} session={route} onOpen={open} onHandoff={() => setHandoffOpen(true)} /></div> : null}
            </div>
            <div style={{
              flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--bg-main)',
              borderRadius: route === 'now' ? '0 12px 12px 12px' : 12,
            }}>
              {route === 'now' ? <Now onOpen={open} state={state} layout={resolved} />
                : route === 'settings' ? <SettingsView prefs={prefs} onPrefs={setPrefs} connection={state} />
                : <SessionView key={route} session={route} rail={rail} onRail={setRail} onOpen={open} handoffOpen={handoffOpen} onHandoffChange={setHandoffOpen} layout={resolved}
                  onLayoutChange={descriptor => window.dispatchEvent(new CustomEvent('ormi-layout-change', { detail: descriptor }))} />}
            </div>
          </main>
          </Panel>
        </Group>
          <Rail route={route} rail={rail} onRail={setRail} onDesign={() => open('design')} />
        </div>}
      </div>
      <Toaster className="toaster group ormi-toast-toaster" position="bottom-center" duration={3000} visibleToasts={1} closeButton={false}
        offset={{ top: 16, right: 16, bottom: toastBottomOffset, left: 16 }}
        mobileOffset={{ top: 16, right: 16, bottom: toastBottomOffset, left: 16 }} />
    </PlatformContext.Provider>
  );
}
