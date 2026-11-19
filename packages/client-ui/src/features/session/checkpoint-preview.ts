import type { TranscriptEvent } from './useTranscript.ts';

export function checkpointPreview(events: TranscriptEvent[], checkpoint: TranscriptEvent) {
  const screenshot = events.find(event =>
    event.kind === 'checkpoint_screenshot' && event.body.checkpoint === checkpoint.body.id);
  const previous = events.filter(event =>
    event.kind === 'checkpoint_screenshot' && event.seq < checkpoint.seq).at(-1);
  return {
    screenshot: typeof screenshot?.body.artifact === 'string' ? screenshot.body.artifact : '',
    previous: previous ? {
      id: String(previous.body.checkpoint ?? ''),
      artifact: String(previous.body.artifact ?? ''),
    } : undefined,
  };
}
