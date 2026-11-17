/** App shell: fixed chrome + arrangeable regions from the layout
 * descriptor. Routes: now / session. Sessions list lives in the sidebar
 * region; the approval surface is rendered by SessionView and may never
 * be hidden by layout. */
import { useEffect, useMemo, useState } from 'react';
import type { ClientPlatform } from '@ormicode/client-platform';
import { PlatformContext } from '../lib/platform.ts';
import { applyTheme, themeByName } from '../lib/theme.ts';
import { defaultLayout, applyLayout, validateLayout } from '../lib/layout.ts';
import type { LayoutDescriptor } from '../lib/layout.ts';
import { SessionList } from '../features/session/SessionList.tsx';
import { Now } from './Now.tsx';
import { SessionView } from './SessionView.tsx';

export function App({ platform, theme = 'dark', layout }: { platform: ClientPlatform; theme?: string; layout?: LayoutDescriptor }) {
  const [route, setRoute] = useState<string>('now');
  const [state, setState] = useState<string>('connecting');
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
  const open = (id: string) => setRoute(id);

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
            <div style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-title)', fontSize: 'var(--text-md)' }}>ormicode</span>
              <span style={{ fontSize: 'var(--text-xs)', color: state === 'online' ? 'var(--accent-mint)' : 'var(--accent-amber)' }}>{state}</span>
            </div>
            <button onClick={() => setRoute('now')} style={{
              margin: '0 var(--space-2) var(--space-2)', padding: '6px var(--space-3)', font: 'inherit', cursor: 'pointer',
              background: route === 'now' ? 'var(--bg-card)' : 'transparent', color: 'var(--text-active)',
              border: 'none', borderRadius: 'var(--radius-sm)', textAlign: 'left',
            }}>Now</button>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SessionList active={route !== 'now' ? route : undefined} onSelect={open} />
            </div>
            <div style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-hint)', borderTop: '1px solid var(--line-pane)' }}>
              {platform.hubLabel}
            </div>
          </aside>
        ) : null}
        <main style={{ flex: 1, minWidth: 0 }}>
          {route === 'now' ? <Now onOpen={open} /> : <SessionView session={route} />}
        </main>
      </div>
    </PlatformContext.Provider>
  );
}
