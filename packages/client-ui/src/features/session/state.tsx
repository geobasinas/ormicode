/** Session state glyphs, colours and labels shared by the sidebar, Now and header. */
import { Play, LoaderCircle, Hand, MessageCircleQuestion, Pause, CircleX, Moon, Check, Archive, RotateCw, type LucideIcon } from 'lucide-react';

export interface StateGlyph { icon: LucideIcon; color: string; fill?: boolean }

export const stateGlyph: Record<string, StateGlyph> = {
  running: { icon: Play, color: 'var(--accent-mint)', fill: true },
  starting: { icon: LoaderCircle, color: 'var(--accent-mint)' },
  retrying: { icon: RotateCw, color: 'var(--accent-amber)' },
  awaiting_approval: { icon: Hand, color: 'var(--accent-amber)' },
  awaiting_input: { icon: MessageCircleQuestion, color: 'var(--accent-amber)' },
  paused_rate_limited: { icon: Pause, color: 'var(--accent-amber)' },
  interrupted: { icon: Pause, color: 'var(--accent-amber)' },
  failed: { icon: CircleX, color: 'var(--accent-red)' },
  idle: { icon: Moon, color: 'var(--text-hint)' },
  done: { icon: Check, color: 'var(--text-secondary)' },
  archived: { icon: Archive, color: 'var(--text-hint)' },
};
export const glyphFor = (state: string): StateGlyph => stateGlyph[state] ?? stateGlyph.idle!;

export const stateLabel = (state: string): string => ({
  awaiting_approval: 'awaiting approval', awaiting_input: 'awaiting input', paused_rate_limited: 'rate limited',
} as Record<string, string>)[state] ?? state;

export const NEEDS_YOU = new Set(['awaiting_approval', 'awaiting_input', 'interrupted', 'failed', 'paused_rate_limited']);
export const LIVE = new Set(['running', 'starting', 'retrying']);

export function StateIcon({ state, size = 13 }: { state: string; size?: number }) {
  const g = glyphFor(state);
  return <g.icon size={size} aria-label={stateLabel(state)} style={{ color: g.color, flexShrink: 0 }} fill={g.fill ? 'currentColor' : 'none'} />;
}

/** Mono sub-line under a session title: `branch` or `scratch · no git`. */
export function whereLine(s: { project: string; branch?: string | null }, withProject?: string): string {
  if (s.project === 'scratch' || !s.branch) return s.project === 'scratch' ? 'scratch · no git' : withProject ?? 'no branch';
  return withProject ? `${withProject} · ${s.branch}` : s.branch;
}
