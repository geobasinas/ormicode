import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '@ormicode/protocol';
import pixelDiff from '@ormicode/pixel-diff';
import { PNG } from 'pngjs';

interface Artifact { mime: string; data: string }
export interface BrowserDiffResult {
  artifact: string; changed: number; total: number; percent: number; width: number; height: number;
}

export class BrowserDiff {
  private readonly dataRoot: string;
  private readonly maxBytes: number;
  private readonly artifact: (session: string, id: string) => Artifact;
  private readonly cache = new Map<string, BrowserDiffResult>();

  constructor(dataRoot: string, maxBytes: number, artifact: (session: string, id: string) => Artifact) {
    this.dataRoot = dataRoot;
    this.maxBytes = maxBytes;
    this.artifact = artifact;
  }

  compare(session: string, a: string, b: string): BrowserDiffResult {
    const key = `${session}\0${a}\0${b}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const first = PNG.sync.read(Buffer.from(this.artifact(session, a).data, 'base64'));
    const second = PNG.sync.read(Buffer.from(this.artifact(session, b).data, 'base64'));
    const width = Math.max(first.width, second.width);
    const height = Math.max(first.height, second.height);
    const total = width * height;
    const left = Buffer.alloc(total * 4);
    const right = Buffer.alloc(total * 4);
    const padded = new Uint8Array(total);
    copyImage(first, left, width);
    copyImage(second, right, width);
    const overlapWidth = Math.min(first.width, second.width);
    const overlapHeight = Math.min(first.height, second.height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= overlapWidth || y >= overlapHeight) padded[y * width + x] = 1;
      }
    }
    const output = Buffer.alloc(total * 4);
    const changedOverlap = pixelDiff(left, right, output, width, height, {
      threshold: 0.1, includeAA: false, alpha: 0.15, diffColor: [255, 0, 0], ignoreMask: padded,
    });
    let paddingPixels = 0;
    for (let index = 0; index < total; index++) {
      if (!padded[index]) continue;
      paddingPixels++;
      output[index * 4] = 255;
      output[index * 4 + 1] = 0;
      output[index * 4 + 2] = 0;
      output[index * 4 + 3] = 255;
    }
    const changed = changedOverlap + paddingPixels;
    const diffImage = new PNG({ width, height });
    output.copy(diffImage.data);
    const png = PNG.sync.write(diffImage);
    if (png.length > this.maxBytes) throw new Error('Diff artifact exceeds the 4 MiB limit.');
    const artifact = newId('bl');
    const directory = join(this.dataRoot, 'sessions', session, 'browser');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, `${artifact}.png`), png, { mode: 0o600, flag: 'wx' });
    const result = { artifact, changed, total, percent: total ? Number((changed * 100 / total).toFixed(2)) : 0, width, height };
    this.cache.set(key, result);
    return result;
  }

  clearSession(session: string): void {
    for (const key of this.cache.keys()) if (key.startsWith(`${session}\0`)) this.cache.delete(key);
  }
}

function copyImage(image: PNG, target: Buffer, width: number): void {
  for (let y = 0; y < image.height; y++) {
    image.data.copy(target, y * width * 4, y * image.width * 4, (y + 1) * image.width * 4);
  }
}
