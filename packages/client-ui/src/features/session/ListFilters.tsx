/** Sidebar state filter chips under the All|Sessions|Bots tabs — 'archived'
 * swaps in the archived list, the rest narrow SessionList via LIST_STATES. */
import { Archive, Hand, Play, type LucideIcon } from 'lucide-react';
import { needsUser } from './team-tree.ts';
import { LIVE } from './state.tsx';
import type { SessionSummary } from './useSessions.ts';

export const LIST_FILTERS: { id: string; label: string; icon: LucideIcon; tint?: string; fill?: boolean }[] = [
  { id: 'waiting', label: 'Needs you', icon: Hand, tint: 'var(--accent-amber)' },
  { id: 'running', label: 'Running', icon: Play, tint: 'var(--accent-mint)', fill: true },
  { id: 'archived', label: 'Archived', icon: Archive },
];

export const LIST_STATES: Record<string, (session: SessionSummary) => boolean> = {
  waiting: needsUser,
  running: session => LIVE.has(session.state),
};

export function ListFilterChips({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 4px 0' }}>
      {LIST_FILTERS.map(({ id, label, icon: Icon, tint, fill }) => {
        const active = value === id;
        return (
          <button key={id} className={active ? undefined : 'hv-sub'} aria-pressed={active}
            title={id === 'archived' ? 'Show archived sessions' : `Show ${label.toLowerCase()} sessions`}
            onClick={() => onChange(active ? undefined : id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, font: 'inherit', fontSize: 11.5,
              fontWeight: active ? 500 : 400, padding: '3px 8px', border: 'none', borderRadius: 7, cursor: 'pointer',
              background: active ? 'var(--bg-selected)' : 'transparent',
              color: active ? 'var(--text-active)' : 'var(--text-secondary)',
            }}>
            <Icon size={12} fill={fill ? 'currentColor' : 'none'} style={{ color: tint ?? (active ? 'var(--text-active)' : 'var(--text-hint)'), flexShrink: 0 }} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
