// Raw agent logs per the README's "Raw logs" spec: the agent's own stdout and
// stderr under <logDir>/stdout.log + stderr.log + meta.json, capped at 5 MB
// (oldest bytes dropped first). Never scrubbed, never leaves the machine.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/** Log a spawned agent's stderr + command/exit. stdout is logged where the
 *  adapter consumes it (a 'data' listener here would race for-await readers). */
export function attachRawLog(child: ChildProcessWithoutNullStreams, log: RawLog | undefined, command?: string, cwd?: string): void {
  if (!log) return;
  log.meta({ ...(command ? { command } : {}), ...(cwd ? { cwd } : {}) });
  child.stderr.on('data', (chunk: Buffer) => log.err(chunk));
  child.once('close', code => log.meta({ exitCode: code }));
}

const CAP = 5 * 1024 * 1024;

export class RawLog {
  private readonly dir?: string;
  constructor(dir?: string) { this.dir = dir; }

  /** Agent stdout — for stream-parsed transports this is the raw bytes, for the SDK it's message JSONL. */
  out(chunk: string | Buffer): void { this.append('stdout.log', chunk); }
  /** Agent stderr. */
  err(chunk: string | Buffer): void { this.append('stderr.log', chunk); }
  /** meta.json: command, cwd, version, exit codes — written once the facts are known. */
  meta(fields: Record<string, unknown>): void {
    if (!this.dir) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const path = join(this.dir, 'meta.json');
      const merged = { ...(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}), ...fields };
      writeFileSync(path, JSON.stringify(merged));
    } catch { /* logging must never break a turn */ }
  }

  private append(file: string, chunk: string | Buffer): void {
    if (!this.dir || !chunk.length) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const path = join(this.dir, file);
      let tail = Buffer.from(chunk);
      if (tail.length > CAP) tail = tail.subarray(-CAP);
      const size = existsSync(path) ? statSync(path).size : 0;
      if (size + tail.length > CAP) {
        // Oldest bytes dropped first: keep the tail that fits.
        const keep = CAP - tail.length;
        writeFileSync(path, keep > 0 ? readFileSync(path).subarray(-keep) : Buffer.alloc(0));
      }
      appendFileSync(path, tail);
    } catch { /* logging must never break a turn */ }
  }
}
