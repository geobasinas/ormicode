import type { TranscriptEvent } from './useTranscript.ts';

export interface CheckpointScreenshotChoice {
  id: string;
  artifact: string;
  label: string;
}

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

export function checkpointScreenshots(events: TranscriptEvent[]): CheckpointScreenshotChoice[] {
  const checkpoints = new Map(events
    .filter(event => event.kind === 'checkpoint')
    .map(event => [String(event.body.id ?? ''), event] as const));
  const prompts = events.filter(event => event.kind === 'prompt');
  return events.flatMap(event => {
    if (event.kind !== 'checkpoint_screenshot') return [];
    const id = String(event.body.checkpoint ?? '');
    const artifact = String(event.body.artifact ?? '');
    if (!id || !artifact) return [];
    const checkpoint = checkpoints.get(id);
    const tool = typeof checkpoint?.body.tool === 'string' ? checkpoint.body.tool.trim() : '';
    const prompt = prompts.filter(item => item.seq < (checkpoint?.seq ?? event.seq)).at(-1);
    const description = tool && !['baseline', 'checkpoint', 'turn'].includes(tool)
      ? tool : String(prompt?.body.text ?? (tool || 'Checkpoint')).replace(/\s+/g, ' ').trim();
    const snippet = description.length > 42 ? `${description.slice(0, 39)}…` : description;
    const timestamp = event.ts ?? checkpoint?.ts;
    const time = typeof timestamp === 'number'
      ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '—';
    return [{ id, artifact, label: `${time} · ${snippet} · ${id.slice(0, 7)}` }];
  });
}
