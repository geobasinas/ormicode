/** App shell: fixed chrome + arrangeable regions from the layout
 * descriptor. Tabs: pinned Now plus one per open session (max 8 —
 * oldest closes first). Closing a tab never stops the session. */
import { useEffect, useMemo, useState } from 'react';
import type { ClientPlatform } from '@ormicode/client-platform';
import { PlatformContext } from '../lib/platform.ts';
import { applyTheme, themeByName } from '../lib/theme.ts';
import { defaultLayout, applyLayout, validateLayout } from '../lib/layout.ts';
import type { LayoutDescriptor } from '../lib/layout.ts';
import { SessionList } from '../features/session/SessionList.tsx';
import { useSession } from '../features/session/useSession.ts';
import { Now } from './Now.tsx';
import { SessionView } from './SessionView.tsx';

const MAX_TABS = 8;

function Tab({ id, active, onSelect, onClose }: { id: string; active: boolean; onSelect: () => void; onClose?: () => void }) {
  const details = useSession(id === 'now' ? undefined : id);
  const label = id === 'now' ? 'Now' : (details?.title || id.slice(0, 14));
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)',
      padding: '3px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', whiteSpace: 'nowrap',
      background: active ? 'var(--bg-card)' : 'transparent',
      color: active ? 'var(--text-active)' : 'var(--text-secondary)',
      border: active ? '1px solid var(--line-card)' : '1px solid transparent',
    }} onClick={onSelect}>
      {label}
      {onClose ? <span style={{ color: 'var(--text-hint)' }} onClick={e => { e.stopPropagation(); onClose(); }}>×</span> : null}
    </span>
  );
}

export function App({ platform, theme = 'dark', layout }: { platform: ClientPlatform; theme?: string; layout?: LayoutDescriptor }) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [route, setRoute] = useState<string>('now');
  const [state, setState] = useState<string>('connecting');
  const [query, setQuery] = useState('');
  const resolved = useMemo(() => {
    if (!layout) return defaultLayout;
    const v = validateLayout(layout);
    return v.ok ? applyLayout(defaultLayout, layout) : defaultLayout;
  }, [layout]);

  useEffect(() => { applyTheme(themeByName(theme)); }, [theme]);
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
      <div style={{
        display: 'flex', height: '100vh', background: 'var(--bg-window)', color: 'var(--text-label)',
        fontFamily: 'var(--font-ui)', fontSize: 'var(--text-md)',
      }}>
        {sidebar?.visible !== false ? (
          <aside style={{
            width: sidebar?.size ?? 260, borderRight: '1px solid var(--line-pane)',
            background: 'var(--bg-window)', display: 'flex', flexDirection: 'column', flexShrink: 0,
          }}>
            <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                background: 'var(--bg-inset)', border: '1px solid var(--line-card)',
                borderRadius: 'var(--radius-sm)', padding: '5px var(--space-2)',
              }}>
                <span style={{ color: 'var(--text-hint)', fontSize: 'var(--text-xs)' }}>⌕</span>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
                  style={{ flex: 1, font: 'inherit', fontSize: 'var(--text-sm)', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-active)' }} />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-hint)' }}>⌃K</span>
              </div>
            </div>
            <button onClick={() => setRoute('now')} style={{
              margin: '0 var(--space-2) var(--space-2)', padding: '6px var(--space-3)', font: 'inherit', cursor: 'pointer',
              background: route === 'now' ? 'var(--bg-card)' : 'transparent', color: 'var(--text-active)',
              border: 'none', borderRadius: 'var(--radius-sm)', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}><span style={{ color: 'var(--text-hint)' }}>✎</span>New session</button>
            <div style={{ display: 'flex', gap: 2, padding: '0 var(--space-3) var(--space-2)', fontSize: 'var(--text-xs)' }}>
              {['All', 'Sessions'].map(f => (
                <button key={f} style={{
                  font: 'inherit', fontSize: 'var(--text-xs)', padding: '3px 10px', cursor: 'pointer',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  background: f === 'All' ? 'var(--bg-raised)' : 'transparent',
                  color: f === 'All' ? 'var(--text-active)' : 'var(--text-secondary)',
                }}>{f}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SessionList active={route !== 'now' ? route : undefined} onSelect={open} query={query} />
            </div>
            <div style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-hint)', borderTop: '1px solid var(--line-pane)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: state === 'online' ? 'var(--accent-mint)' : 'var(--accent-amber)' }} title={state} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{platform.hubLabel}</span>
              {platform.desktop?.storageBackend() === 'basic_text' ? (
                <div style={{ color: 'var(--accent-amber)', marginTop: 'var(--space-1)' }}>
                  no OS keyring — device token is only obfuscated
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', gap: 'var(--space-1)', padding: 'var(--space-1) var(--space-2)',
            borderBottom: '1px solid var(--line-pane)', background: 'var(--bg-window)',
            overflowX: 'auto', flexShrink: 0,
          }}>
            <Tab id="now" active={route === 'now'} onSelect={() => setRoute('now')} />
            {tabs.map(t => <Tab key={t} id={t} active={route === t} onSelect={() => setRoute(t)} onClose={() => close(t)} />)}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {route === 'now' ? <Now onOpen={open} state={state} /> : <SessionView key={route} session={route} />}
          </div>
        </main>
      </div>
    </PlatformContext.Provider>
  );
}
