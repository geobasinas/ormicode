/** App shell: custom titlebar (frameless window), sidebar with search /
 * new-session / All|Sessions|Bots filter / grouped session list, and the
 * pinned Now tab + session tabs from the layout descriptor. */
import { useEffect, useMemo, useState } from 'react';
import type { ClientPlatform } from '@ormicode/client-platform';
import { PlatformContext } from '../lib/platform.ts';
import { applyTheme, themeByName } from '../lib/theme.ts';
import { defaultLayout, applyLayout, validateLayout } from '../lib/layout.ts';
import type { LayoutDescriptor } from '../lib/layout.ts';
import { PanelLeft, Minus, Square, X, Search, SquarePen, Settings } from 'lucide-react';
import { SessionList } from '../features/session/SessionList.tsx';
import { useSession } from '../features/session/useSession.ts';
import { Now } from './Now.tsx';
import { SessionView } from './SessionView.tsx';

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
          <button style={btn} onClick={() => d.winMin()} title="Minimize"><Minus size={15} style={{ display: 'block', margin: 'auto' }} /></button>
          <button style={btn} onClick={() => d.winMax()} title="Maximize"><Square size={13} style={{ display: 'block', margin: 'auto' }} /></button>
          <button style={btn} onClick={() => d.winClose()} title="Close"><X size={16} style={{ display: 'block', margin: 'auto' }} /></button>
        </span>
      ) : null}
    </div>
  );
}

function Tab({ id, active, onSelect, onClose }: { id: string; active: boolean; onSelect: () => void; onClose?: () => void }) {
  const details = useSession(id === 'now' ? undefined : id);
  const label = id === 'now' ? 'Home' : (details?.title || id.slice(0, 14));
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
      padding: '4px 12px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
      background: active ? 'var(--bg-raised)' : 'transparent',
      color: active ? 'var(--text-active)' : 'var(--text-secondary)',
    }} onClick={onSelect}>
      {label}
      {onClose ? <X size={12} style={{ color: 'var(--text-hint)' }} onClick={e => { e.stopPropagation(); onClose(); }} /> : null}
    </span>
  );
}

const FILTER_TABS = ['All', 'Sessions', 'Bots'] as const;

export function App({ platform, theme = 'dark', layout }: { platform: ClientPlatform; theme?: string; layout?: LayoutDescriptor }) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [route, setRoute] = useState<string>('now');
  const [state, setState] = useState<string>('connecting');
  const [query, setQuery] = useState('');
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef]);
  useEffect(() => {
    platform.transport.onState = setState;
    platform.transport.onState?.(state);
  }, [platform]);

  const sidebar = resolved.regions.sidebar;
  const open = (id: string) => {
    setTabs(ts => ts.includes(id) ? ts : [...ts.slice(-(MAX_TABS - 1)), id]);
    setRoute(id);
  };
  const close = (id: string) => setTabs(ts => {
    const next = ts.filter(t => t !== id);
    if (route === id) setRoute(next[next.length - 1] ?? 'now');
    return next;
  });

  return (
    <PlatformContext.Provider value={platform}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-window)', color: 'var(--text-label)', fontFamily: 'var(--font-ui)', fontSize: 14 }}>
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
                  style={{ flex: 1, font: 'inherit', fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-label)' }} />
                <span style={{ fontSize: 10, color: '#5e5e5e' }}>Ctrl K</span>
              </div>
              <button onClick={() => setRoute('now')} style={{
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
              <div style={{ padding: '8px 10px 0', borderTop: '1px solid var(--line-pane)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Settings size={15} style={{ color: 'var(--text-label)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-label)' }}>Settings</span>
              </div>
              <div style={{ padding: '6px 10px 0', fontSize: 11, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: state === 'online' ? 'var(--accent-mint)' : 'var(--accent-amber)' }} title={state} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platform.hubLabel}</span>
              </div>
              {platform.desktop?.storageBackend() === 'basic_text' ? (
                <div style={{ padding: '4px 10px 0', fontSize: 11, color: 'var(--accent-amber)' }}>no OS keyring — token only obfuscated</div>
              ) : null}
            </aside>
          ) : null}
          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-main)', borderTopLeftRadius: 10, border: '1px solid var(--line-pane)', borderRight: 'none', borderBottom: 'none', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--line-pane)', overflowX: 'auto', flexShrink: 0 }}>
              <Tab id="now" active={route === 'now'} onSelect={() => setRoute('now')} />
              {tabs.map(t => <Tab key={t} id={t} active={route === t} onSelect={() => setRoute(t)} onClose={() => close(t)} />)}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {route === 'now' ? <Now onOpen={open} state={state} /> : <SessionView key={route} session={route} />}
            </div>
          </main>
        </div>
      </div>
    </PlatformContext.Provider>
  );
}
