// Utility calls (README "Daemon"): small hidden model calls for titles,
// digest summaries and briefs, made through an installed agent in-process.
// One at a time per machine, 10 s cap, no retries, daily USD cap — and every
// caller must fall back to mechanical output when a call fails or is skipped.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentAdapter } from '@ormicode/agent-core';
import { createAdapter } from './registry.ts';
import { ormicodeDir } from './socket.ts';

const DEFAULT_CANDIDATES: [string, string][] = [
  ['claude', 'sdk'], ['claude', 'cli'], ['codex', 'cli'], ['opencode', 'cli'], ['pi', 'cli'],
];

export interface UtilityResult { text: string; model?: string; usage?: { input: number; output: number } }
export type CreateAdapter = (vendor: string, transport: string) => Promise<AgentAdapter>;

const dayKey = () => new Date().toISOString().slice(0, 10);

export class UtilityCalls {
  private queue: Promise<unknown> = Promise.resolve();
  private adapterPick: [string, string] | undefined;
  private readonly spendPath: string;
  private readonly readSetting: (key: string) => unknown;
  private readonly makeAdapter: CreateAdapter;
  private readonly now: () => number;

  constructor(opts: {
    readSetting?: (key: string) => unknown;
    createAdapter?: CreateAdapter;
    dir?: string;
    now?: () => number;
  } = {}) {
    this.readSetting = opts.readSetting ?? (() => undefined);
    this.makeAdapter = opts.createAdapter ?? ((vendor, transport) => createAdapter(vendor, transport, {}));
    this.spendPath = join(opts.dir ?? ormicodeDir(), 'utility-spend.json');
    this.now = opts.now ?? Date.now;
  }

  private spend(): { day: string; usd: number } {
    try {
      const s = JSON.parse(readFileSync(this.spendPath, 'utf8')) as { day?: string; usd?: number };
      return s.day === dayKey() ? { day: dayKey(), usd: Number(s.usd) || 0 } : { day: dayKey(), usd: 0 };
    } catch { return { day: dayKey(), usd: 0 }; }
  }
  private charge(usd: number): void {
    try {
      const s = this.spend();
      mkdirSync(ormicodeDir(), { recursive: true });
      writeFileSync(this.spendPath, JSON.stringify({ day: s.day, usd: s.usd + usd }));
    } catch { /* spending accounting is best-effort */ }
  }
  private capUsd(): number {
    const v = this.readSetting('utility.dailyCapUsd');
    return typeof v === 'number' && v >= 0 ? v : 1;
  }

  /** Daily budget left, in USD. */
  budgetLeft(): number { return Math.max(0, this.capUsd() - this.spend().usd); }

  private async pickAdapter(): Promise<AgentAdapter> {
    const wanted = this.readSetting('utility.agent');
    const candidates: [string, string][] = [];
    if (typeof wanted === 'string' && wanted && wanted !== 'default') {
      const [vendor, transport = 'cli'] = wanted.split('/') as [string, string?];
      candidates.push([vendor, transport]);
    }
    candidates.push(...DEFAULT_CANDIDATES);
    for (const [vendor, transport] of candidates) {
      try {
        const adapter = await this.makeAdapter(vendor, transport);
        if ((await adapter.detect()).available) { this.adapterPick = [vendor, transport]; return adapter; }
        await adapter.dispose?.({ id: 'probe' }).catch(() => undefined);
      } catch { /* try the next candidate */ }
    }
    throw new Error('no utility agent available');
  }

  /**
   * One hidden turn through an installed agent. Serialized per machine and
   * capped at 10 s; returns undefined on any failure or when the daily cap is
   * spent — callers always fall back, nothing waits on a utility call.
   */
  call(prompt: string, opts: { session?: string; costUsd?: number; timeoutMs?: number } = {}): Promise<UtilityResult | undefined> {
    const run = this.queue.then(async () => {
      if (opts.costUsd !== undefined ? this.budgetLeft() < opts.costUsd : this.budgetLeft() <= 0) return undefined;
      const timeoutMs = opts.timeoutMs ?? 10_000;
      let adapter: AgentAdapter | undefined;
      let handle: { id: string } | undefined;
      try {
        adapter = this.adapterPick
          ? await this.makeAdapter(this.adapterPick[0], this.adapterPick[1])
          : await this.pickAdapter();
        handle = await adapter.start({ cwd: tmpdir() });
        const done = (async () => {
          const chunks: string[] = [];
          let usage: UtilityResult['usage'];
          let costUsd: number | undefined;
          for await (const event of adapter!.events(handle!)) {
            if (event.kind === 'text' && typeof event.text === 'string') chunks.push(event.text);
            else if (event.kind === 'usage') {
              usage = { input: Number(event.input) || 0, output: Number(event.output) || 0 };
              if (typeof event.costUsd === 'number') costUsd = event.costUsd;
            } else if (event.kind === 'turn_end') break;
          }
          return { text: chunks.join(''), usage, costUsd };
        })();
        await adapter.prompt(handle, { text: prompt });
        const result = await Promise.race([
          done,
          new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), timeoutMs)),
        ]);
        if (result === 'timeout') { await adapter.interrupt?.(handle).catch(() => undefined); return undefined; }
        // Real reported cost when the agent gives one, else a conservative charge.
        this.charge(result.costUsd ?? 0.005);
        return { text: result.text, ...(result.usage ? { usage: result.usage } : {}) };
      } catch { return undefined; }
      finally {
        if (adapter && handle) await adapter.dispose(handle).catch(() => undefined);
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
