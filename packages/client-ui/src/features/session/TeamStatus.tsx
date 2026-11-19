import { Play, ShieldCheck, Unplug, CircleX, Check, Moon } from 'lucide-react';
import type { SessionSummary } from './useSessions.ts';
import { teamState } from './team-presentation.ts';

type State = Pick<SessionSummary, 'state' | 'parentless' | 'delegatedApproval'>;
const icons = { running: Play, waiting: ShieldCheck, parentless: Unplug, failed: CircleX, done: Check, idle: Moon };
export function TeamStateIcon({ session }: { session: State }) {
  const state = teamState(session), Icon = icons[state.icon as keyof typeof icons];
  return <Icon size={12} strokeWidth={1.8} className={`team-tone-${state.tone}`} aria-label={state.label} />;
}
export function TeamStatus({ session }: { session: State }) {
  const state = teamState(session);
  return <span className={`team-status team-tone-${state.tone}`} title={state.help}>{state.label}</span>;
}
