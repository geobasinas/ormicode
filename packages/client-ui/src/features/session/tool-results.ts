import type { TranscriptEvent } from './useTranscript.ts';

export function transcriptToolResults(events: TranscriptEvent[]): Map<string, TranscriptEvent> {
  const results = new Map<string, TranscriptEvent>();
  const open = new Map<string, TranscriptEvent>();
  for (const event of events) {
    const id = String(event.body.callId);
    if (event.kind === 'turn_start' || event.kind === 'turn_end') open.clear();
    else if (event.kind === 'tool_call') { results.delete(id); open.set(id, event); }
    else if (event.kind === 'tool_result' && open.has(id)) { results.set(id, event); open.delete(id); }
    else if (event.kind === 'interrupted') {
      for (const [callId, call] of open) results.set(callId, { ...event, kind: 'tool_result', body: { callId, status: 'interrupted', ...(call.body.parent ? { parent: call.body.parent } : {}) } });
      open.clear();
    }
  }
  return results;
}
