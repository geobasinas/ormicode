/** Shell chrome for the app frame: titlebar, session tabs and the right-hand tool rail. */
import { useLayoutEffect, useRef } from 'react';
import type { ClientPlatform } from '@ormicode/client-platform';
import { PanelLeft, Minus, Square, X, GitBranch, FolderOpen, SquareTerminal, NotebookPen, Globe, PenTool, type LucideIcon } from 'lucide-react';
import { useSession } from '../features/session/useSession.ts';
import { SessionHeader } from '../features/session/SessionHeader.tsx';
import { NEEDS_YOU } from '../features/session/state.tsx';
import { branchLabel } from '../features/session/team-presentation.ts';
import { WorkspaceSwitcher, type Workspace } from '../routes/WorkspaceSwitcher.tsx';

export const noDrag = { WebkitAppRegion: 'no-drag' } as const;
const drag = { WebkitAppRegion: 'drag' } as const;

export function Titlebar({ platform, workspace, onWorkspaceChange, sidebarOpen, onSidebarToggle }: {
  platform: ClientPlatform; workspace: Workspace; onWorkspaceChange(workspace: Workspace): void; sidebarOpen: boolean; onSidebarToggle(): void;
}) {
  const d = platform.desktop;
  const btn = { ...noDrag, width: 30, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: 'inherit', border: 'none', borderRadius: 7, cursor: 'default', background: 'transparent', color: 'var(--text-secondary)' };
  return (
    <div className="app-titlebar" style={{ ...drag, height: 40, display: 'flex', alignItems: 'center', paddingLeft: 14, background: 'var(--bg-window)', flexShrink: 0 }}>
      <button type="button" className="hv" title="Toggle sidebar" aria-label="Toggle sidebar" aria-expanded={sidebarOpen} onClick={onSidebarToggle}
        style={{ ...noDrag, display: 'grid', placeItems: 'center', padding: 4, borderRadius: 5, marginLeft: -4, marginRight: -4, color: 'var(--text-secondary)' }}><PanelLeft size={15} /></button>
      <WorkspaceSwitcher workspace={workspace} onChange={onWorkspaceChange} />
      <span style={{ flex: 1 }} />
      {d ? (
        <span style={{ display: 'flex', gap: 2, paddingRight: 8 }}>
          <button className="hv" style={btn} onClick={() => d.winMin()} title="Minimize"><Minus size={13} /></button>
          <button className="hv" style={btn} onClick={() => d.winMax()} title="Maximize"><Square size={11} /></button>
          <button className="hv hv-close" style={btn} onClick={() => d.winClose()} title="Close"><X size={14} /></button>
        </span>
      ) : null}
    </div>
  );
}

export const PAGES: Record<string, string> = { now: 'Home', design: 'Design', settings: 'Settings' };

export function Tab({ id, n, active, onSelect, onClose }: { id: string; n?: number; active: boolean; onSelect: () => void; onClose?: () => void }) {
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
        {active && details?.project !== 'scratch' && details?.branch ? <span title={details.branch} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 400, color: 'var(--text-secondary)' }}><GitBranch size={10} />{branchLabel(details)}</span> : null}
        {onClose ? <X size={12} className="hv-x" style={{ color: 'var(--text-hint)', borderRadius: 4 }} onClick={e => { e.stopPropagation(); onClose(); }} /> : null}
      </span>
      {active ? fillet('right') : null}
      {active && id !== 'now' ? fillet('left') : null}
    </span>
  );
}

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

export function Rail({ route, rail, onRail, onDesign }: { route: string; rail: RailPane; onRail: (r: RailPane) => void; onDesign(): void }) {
  const isSession = !PAGES[route];
  const details = useSession(isSession ? route : undefined);
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

export function ActiveHeader({ session, onOpen, onHandoff, onArchived }: { session: string; onOpen: (session: string) => void; onHandoff(): void; onArchived(): void }) {
  const details = useSession(session);
  return <SessionHeader session={session} details={details} onOpen={onOpen} onHandoff={onHandoff} onArchived={onArchived} />;
}
