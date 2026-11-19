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

export function samePixelBytes(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode checkpoint screenshot'));
    image.src = source;
  });
}

export async function screenshotsPixelIdentical(left: string, right: string): Promise<boolean> {
  const [first, second] = await Promise.all([loadImage(left), loadImage(right)]);
  if (first.naturalWidth !== second.naturalWidth || first.naturalHeight !== second.naturalHeight) return false;
  const width = first.naturalWidth;
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  const side = width * 4;
  for (let y = 0; y < first.naturalHeight; y++) {
    context.clearRect(0, 0, width * 2, 1);
    context.drawImage(first, 0, y, width, 1, 0, 0, width, 1);
    context.drawImage(second, 0, y, width, 1, width, 0, width, 1);
    const pixels = context.getImageData(0, 0, width * 2, 1).data;
    if (!samePixelBytes(pixels.subarray(0, side), pixels.subarray(side))) return false;
  }
  return true;
}
