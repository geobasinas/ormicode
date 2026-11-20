import type { TranscriptEvent } from './useTranscript.ts';

export type TranscriptPart = { kind: 'events'; events: TranscriptEvent[] }
  | { kind: 'turn'; start: TranscriptEvent; end?: TranscriptEvent; prompt?: TranscriptEvent; events: TranscriptEvent[] };

export function transcriptTurns(events: TranscriptEvent[]): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  let current: TranscriptPart | undefined;
  let promptSeen = false;
  for (const event of events) {
    if (event.kind === 'turn_start') {
      promptSeen = current?.kind === 'events' && current.events.some(event => event.kind === 'prompt');
      if (current?.kind === 'turn' && !current.end) current.end = event;
      current = { kind: 'turn', start: event, events: [] }; parts.push(current);
    } else if (event.kind === 'prompt') {
      if (current?.kind === 'turn' && !current.end) {
        if (!promptSeen && event.body.steer !== true) { current.prompt = event; promptSeen = true; }
        current.events.push(event);
        continue;
      }
      current = { kind: 'events', events: [event] }; parts.push(current);
    } else {
      if (!current) { current = { kind: 'events', events: [] }; parts.push(current); }
      current.events.push(event);
      if (current.kind === 'turn' && (event.kind === 'turn_end' || event.kind === 'interrupted')) {
        current.end = event; current = undefined;
      }
    }
  }
  return parts;
}

const workKinds = new Set(['tool_call', 'tool_result', 'thinking', 'thinking_delta', 'plan', 'checkpoint', 'browser_action']);
const isText = (event: TranscriptEvent) => event.kind === 'text' || event.kind === 'text_delta';
export function turnContents(events: TranscriptEvent[], prompt?: TranscriptEvent) {
  const lastText = events.findLastIndex(event => isText(event) && typeof event.body.parent !== 'string');
  const lastWork = events.findLastIndex((event, index) => index < lastText &&
    (workKinds.has(event.kind) && event.kind !== 'checkpoint' && event.kind !== 'tool_result' || typeof event.body.parent === 'string'));
  const activity: TranscriptEvent[] = [], visible: TranscriptEvent[] = [];
  events.forEach((event, index) => {
    const inside = event.kind === 'prompt' && event !== prompt || workKinds.has(event.kind) || typeof event.body.parent === 'string' || isText(event) && index < lastWork;
    (inside ? activity : visible).push(event);
  });
  return { activity, visible };
}
