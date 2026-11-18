// Output ring: keeps the last `maxLines` lines (and at most `maxBytes`) of a
// terminal's raw output, addressed by absolute byte offset.
export class Scrollback {
  private chunks: Buffer[] = [];
  private lines = 0;
  private bytes = 0;
  start = 0;
  end = 0;
  readonly maxLines: number;
  readonly maxBytes: number;
  constructor(maxLines = 5000, maxBytes = 4 * 1024 * 1024) { this.maxLines = maxLines; this.maxBytes = maxBytes; }

  push(chunk: Buffer): number {
    const at = this.end;
    this.chunks.push(chunk); this.end += chunk.length; this.bytes += chunk.length; this.lines += count(chunk);
    while (this.chunks.length > 1 && (this.lines > this.maxLines || this.bytes > this.maxBytes)) {
      const old = this.chunks.shift()!;
      this.start += old.length; this.bytes -= old.length; this.lines -= count(old);
    }
    return at;
  }

  /** Bytes from `from` (clamped to what is kept) to the end. */
  since(from: number): { offset: number; data: Buffer } {
    const offset = Math.max(from, this.start);
    const all = Buffer.concat(this.chunks);
    return { offset, data: all.subarray(Math.min(offset - this.start, all.length)) };
  }
}

const count = (b: Buffer) => { let n = 0; for (const c of b) if (c === 10) n++; return n; };
