/** App shell: custom titlebar (frameless window), sidebar with search /
 * new-session / All|Sessions|Bots filter / grouped session list, and the
 * pinned Now tab + session tabs from the layout descriptor. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ClientPlatform } from '@ormicode/client-platform';
import { PlatformContext } from '../lib/platform.ts';
import { applyTheme, themeByName } from '../lib/theme.ts';
import { defaultLayout, applyLayout, validateLayout } from '../lib/layout.ts';
import type { LayoutDescriptor } from '../lib/layout.ts';
import { PanelLeft, Minus, Square, X, Search, SquarePen, Settings, GitBranch, FolderOpen, SquareTerminal, NotebookPen, Globe, type LucideIcon } from 'lucide-react';
import { SessionList } from '../features/session/SessionList.tsx';
import { useSession } from '../features/session/useSession.ts';
import { Now } from './Now.tsx';
import { SessionView } from './SessionView.tsx';
import { SettingsView, loadPrefs, type Prefs } from './Settings.tsx';
import { SessionHeader } from '../features/session/SessionHeader.tsx';

const MAX_TABS = 8;
const drag = { WebkitAppRegion: 'drag' } as const;
const noDrag = { WebkitAppRegion: 'no-drag' } as const;

function Titlebar({ platform }: { platform: ClientPlatform }) {
  const d = platform.desktop;
  const btn = { ...noDrag, width: 46, height: 40, font: 'inherit', fontSize: 13, border: 'none', cursor: 'default', background: 'transparent', color: '#ababab' };
  return (
    <div style={{ ...drag, height: 40, display: 'flex', alignItems: 'center', paddingLeft: 14, background: 'var(--bg-window)', flexShrink: 0 }}>
      <PanelLeft size={15} style={{ ...noDrag, color: '#8a8a8a' }} />
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

const PAGES: Record<string, string> = { now: 'Home', settings: 'Settings' };

function Tab({ id, n, active, onSelect, onClose }: { id: string; n?: number; active: boolean; onSelect: () => void; onClose?: () => void }) {
  const details = useSession(PAGES[id] ? undefined : id);
  const label = PAGES[id] ?? (details?.title || id.slice(0, 14));
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
      color: active ? 'var(--text-title)' : 'var(--text-secondary)',
    }} onClick={onSelect}>
      <span className={active ? undefined : 'hv-tab'} style={{ position: 'relative', zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 11px', borderRadius: 8 }}>
        {n !== undefined ? <span style={{ width: 18, height: 18, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: active ? 'var(--bg-badge)' : 'var(--bg-raised)', color: active ? 'var(--text-onAccent)' : 'var(--text-label)', fontSize: 10, fontWeight: 700 }}>{n}</span> : null}
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {onClose ? <X size={12} className="hv-x" style={{ color: 'var(--text-hint)', borderRadius: 4 }} onClick={e => { e.stopPropagation(); onClose(); }} /> : null}
      </span>
      {active ? fillet('right') : null}
      {active && id !== 'now' ? fillet('left') : null}
    </span>
  );
}

const FILTER_TABS = ['All', 'Sessions', 'Bots'] as const;

const RAIL_ICONS: { id: string; icon: LucideIcon; label: string; soon?: boolean }[] = [
  { id: 'git', icon: GitBranch, label: 'git — soon', soon: true },
  { id: 'files', icon: FolderOpen, label: 'files — soon', soon: true },
  { id: 'terminal', icon: SquareTerminal, label: 'terminal — soon', soon: true },
  { id: 'notes', icon: NotebookPen, label: 'notes' },
  { id: 'web', icon: Globe, label: 'web — soon', soon: true },
];

function Rail({ route, rail, onRail }: { route: string; rail: string; onRail: (r: 'none' | 'notes') => void }) {
  const isSession = route !== 'now';
  return (
    <div style={{
      width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '12px 0 0', gap: 4, background: 'var(--bg-window)', alignSelf: 'flex-start',
    }}>
      {RAIL_ICONS.map(({ id, icon: Icon, label, soon }) => {
        const enabled = id === 'notes' ? isSession : !soon;
        const active = id === 'notes' && rail === 'notes';
        return (
          <button key={id} className={enabled && !active ? 'hv' : undefined} title={enabled ? label : `${label} — soon`} aria-disabled={!enabled}
            onClick={() => enabled && id === 'notes' && onRail(rail === 'notes' ? 'none' : 'notes')}
            style={{
              width: 32, height: 32, border: 'none', borderRadius: 8, cursor: enabled ? 'pointer' : 'default',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: active ? 'var(--bg-raised)' : 'transparent',
              color: active ? 'var(--text-active)' : 'var(--text-hint)',
              opacity: enabled ? 1 : 0.45,
            }}><Icon size={16} /></button>
        );
      })}
    </div>
  );
}

function ActiveHeader({ session }: { session: string }) {
  const details = useSession(session);
  return <SessionHeader session={session} details={details} />;
}

export function App({ platform, theme: initialTheme, layout }: { platform: ClientPlatform; theme?: string; layout?: LayoutDescriptor }) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(initialTheme));
  const theme = prefs.theme;
  const [tabs, setTabs] = useState<string[]>([]);
  const [route, setRoute] = useState<string>('now');
  const [state, setState] = useState<string>('connecting');
  const [query, setQuery] = useState('');
  const [rail, setRail] = useState<'none' | 'notes'>('none');
  const [filter, setFilter] = useState<(typeof FILTER_TABS)[number]>('All');
  const resolved = useMemo(() => {
    if (!layout) return defaultLayout;
    const v = validateLayout(layout);
    return v.ok ? applyLayout(defaultLayout, layout) : defaultLayout;
  }, [layout]);

  useEffect(() => { applyTheme(themeByName(theme)); }, [theme]);
  const searchRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setRoute('now'); }
      if (e.key === '1') { e.preventDefault(); setRoute('now'); }
      if (e.key === ',') { e.preventDefault(); openRef.current('settings'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef]);
  useEffect(() => {
    platform.transport.onState = setState;
    platform.transport.onState?.(state);
  }, [platform]);

  const sidebar = resolved.regions.sidebar;
  const openRef = useRef((id: string) => { void id; });
  const open = (id: string) => {
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
        <Titlebar platform={platform} />
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {sidebar?.visible !== false ? (
            <aside style={{
              width: sidebar?.size ?? 268, flexShrink: 0, display: 'flex', flexDirection: 'column',
              gap: 1, padding: '12px 8px 6px', background: 'var(--bg-window)',
            }}>
              <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--line-divider)' }}>
                <Search size={15} style={{ color: 'var(--text-label)', flexShrink: 0 }} />
                <input ref={el => { searchRef.current = el; }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
                  style={{ flex: 1, minWidth: 0, font: 'inherit', fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-label)' }} />
                <span style={{ fontSize: 10, color: '#5e5e5e', whiteSpace: 'nowrap' }}>Ctrl K</span>
              </div>
              <button className="hv-sub" onClick={() => setRoute('now')} style={{
                height: 30, marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px',
                font: 'inherit', fontSize: 13, cursor: 'pointer', background: 'transparent', border: 'none',
                borderRadius: 8, color: 'var(--text-title)', textAlign: 'left',
              }}>
                <SquarePen size={15} style={{ color: 'var(--text-title)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>New session</span>
                <span style={{ fontSize: 10, color: '#5e5e5e' }}>Ctrl N</span>
              </button>
              <div style={{ height: 4 }} />
              <div style={{ display: 'flex', padding: '0 2px' }}>
                <div style={{ flex: 1, display: 'flex', gap: 2, padding: 2, background: 'var(--bg-inset)', borderRadius: 9 }}>
                  {FILTER_TABS.map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{
                      flex: 1, font: 'inherit', fontSize: 12, fontWeight: filter === f ? 500 : 400, cursor: 'pointer',
                      padding: '4px 0', border: 'none', borderRadius: 7, textAlign: 'center',
                      background: filter === f ? '#2f2f2f' : 'transparent',
                      color: filter === f ? 'var(--text-active)' : '#888888',
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
                background: route === 'settings' ? 'var(--bg-inset)' : 'transparent',
              }}>
                <Settings size={15} style={{ color: route === 'settings' ? 'var(--text-title)' : 'var(--text-label)', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: route === 'settings' ? 'var(--text-title)' : '#cbcbcb' }}>Settings</span>
              </button>
            </aside>
          ) : null}
          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', margin: '12px 0 18px 18px' }}>
            <div style={{ display: 'flex', gap: 10, flexShrink: 0, position: 'relative', zIndex: 1, marginBottom: -1 }}>
              <Tab id="now" active={route === 'now'} onSelect={() => setRoute('now')} />
              {tabs.map((t, i) => <Tab key={t} id={t} n={PAGES[t] ? undefined : tabs.filter(x => !PAGES[x]).indexOf(t) + 1} active={route === t} onSelect={() => setRoute(t)} onClose={() => close(t)} />)}
              <span style={{ flex: 1 }} />
              {!PAGES[route] ? <div style={{ ...noDrag, minWidth: 0, display: 'flex' }}><ActiveHeader key={route} session={route} /></div> : null}
            </div>
            <div style={{
              flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--bg-main)',
              borderRadius: route === 'now' ? '0 12px 12px 12px' : 12,
            }}>
              {route === 'now' ? <Now onOpen={open} state={state} />
                : route === 'settings' ? <SettingsView prefs={prefs} onPrefs={setPrefs} connection={state} />
                : <SessionView key={route} session={route} rail={rail} onRail={setRail} />}
            </div>
          </main>
          <Rail route={route} rail={rail} onRail={setRail} />
        </div>
      </div>
    </PlatformContext.Provider>
  );
}
