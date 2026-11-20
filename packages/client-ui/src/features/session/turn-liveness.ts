import type { TranscriptEvent } from './useTranscript.ts';

export interface TranscriptActivity { state: string; lastSeq?: number }

const activeStates = new Set(['starting', 'running', 'retrying', 'awaiting_approval', 'awaiting_input']);

export function activeTurnStart(events: TranscriptEvent[], activity?: TranscriptActivity): number | undefined {
  if (!activity) return undefined;
  let state = activity.state;
  let start: number | undefined;
  for (const event of events) {
    if (event.kind === 'turn_start') start = event.seq;
    else if (['turn_end', 'interrupted', 'conversation_rewound'].includes(event.kind)) start = undefined;
    if (event.seq <= (activity.lastSeq ?? Infinity)) continue;
    if (event.kind === 'turn_start') state = 'running';
    else if (event.kind === 'turn_end' || event.kind === 'conversation_rewound') state = 'idle';
    else if (event.kind === 'interrupted') state = 'interrupted';
    else if (event.kind === 'state' && typeof event.body.state === 'string') state = event.body.state;
  }
  return activeStates.has(state) ? start : undefined;
}
