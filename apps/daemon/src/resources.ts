// Resource measurement and pool sizing (README "Resources"). Nothing is
// guessed from hostnames: RAM, disk and battery are sampled, the warm pool is
// (available RAM - reserve) / average worker size, capped, and every override
// is reported next to the computed value.
import { totalmem, freemem, cpus, platform } from 'node:os';
import { statfsSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadMachineConfig, type MachineConfig } from './machine-config.ts';

const GB = 1e9, MB = 1e6;
const reserveDefault = () => (platform() === 'win32' ? 3 * GB : 2 * GB);
const AVG_WORKER_START = 400 * MB;
const POOL_CAP_DEFAULT = 20;
const DISK_FLOOR_DEFAULT = 5 * GB;
const IDLE_DEFAULT = { laptop: 20 * 60_000, vps: 40 * 60_000 } as const;

export interface ResourceProbe {
  totalRam: number; freeRam: number; cores: number;
  diskFree: number | undefined; onBattery: boolean | undefined; vm: boolean | undefined;
}
export type ProbeFn = (dir: string, withBattery: boolean) => ResourceProbe;
export interface PoolComputation {
  mode: 'auto' | 'fixed'; computed: number; effective: number; cap: number;
  overrides: { env?: number; machine?: number; cap?: number };
}

function defaultProbe(dir: string, withBattery: boolean): ResourceProbe {
  let diskFree: number | undefined;
  try { const s = statfsSync(dir); diskFree = s.bavail * s.bsize; } catch { /* unknown */ }
  return { totalRam: totalmem(), freeRam: freemem(), cores: cpus().length, diskFree, onBattery: withBattery ? probeBattery() : undefined, vm: probeVm() };
}

function probeVm(): boolean | undefined {
  if (platform() !== 'linux') return undefined;
  return existsSync('/.dockerenv') || existsSync('/sys/hypervisor') || existsSync('/run/.containerenv');
}

function probeBattery(): boolean | undefined {
  try {
    if (platform() === 'linux') {
      const base = '/sys/class/power_supply';
      if (!existsSync(base)) return undefined;
      for (const name of readdirSync(base)) {
        try {
          if (readFileSync(join(base, name, 'type'), 'utf8').trim() !== 'Battery') continue;
          return readFileSync(join(base, name, 'status'), 'utf8').trim() === 'Discharging';
        } catch { /* next entry */ }
      }
      return false;
    }
    if (platform() === 'darwin') {
      const out = execFileSync('pmset', ['-g', 'ps'], { encoding: 'utf8', timeout: 5_000 });
      return out.includes('Battery Power');
    }
    if (platform() === 'win32') {
      // Win32_Battery.BatteryStatus: 1 = discharging (on battery), 2 = on AC.
      // Desktops without a battery print nothing and count as plugged in.
      const out = execFileSync('powershell', ['-NoProfile', '-Command',
        "(Get-CimInstance Win32_Battery | Select-Object -First 1).BatteryStatus"], { encoding: 'utf8', timeout: 10_000 }).trim();
      return out === '' ? false : Number(out) === 1;
    }
  } catch { /* probe failed: battery state unknown */ }
  return undefined;
}

export class Resources {
  private readonly dir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly readSetting: ((key: string) => unknown) | undefined;
  private readonly probe: ProbeFn;
  private sampleAt = 0;
  private probeResult: ResourceProbe = { totalRam: totalmem(), freeRam: freemem(), cores: cpus().length, diskFree: undefined, onBattery: undefined, vm: undefined };
  private readonly workerRss = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: { dir: string; env?: NodeJS.ProcessEnv; readSetting?: (key: string) => unknown; probe?: ProbeFn; sampleMs?: number }) {
    this.dir = opts.dir;
    this.env = opts.env ?? process.env;
    this.readSetting = opts.readSetting;
    this.probe = opts.probe ?? defaultProbe;
    const sampleMs = opts.sampleMs ?? 60_000;
    // Battery probing can shell out (PowerShell/pmset), so it only runs on the
    // interval, never on the startup path.
    this.timer = setInterval(() => this.refresh(true), sampleMs);
    this.timer.unref();
    this.refresh(false);
  }

  refresh(withBattery = false): void { this.sampleAt = Date.now(); this.probeResult = this.probe(this.dir, withBattery); }
  close(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  observeWorker(session: string, rssBytes: number): void {
    if (Number.isFinite(rssBytes) && rssBytes > 0) this.workerRss.set(session, rssBytes);
  }
  forgetWorker(session: string): void { this.workerRss.delete(session); }

  private config(): MachineConfig { return loadMachineConfig(this.dir); }
  private account(key: string): unknown { return this.readSetting?.(key); }

  private number(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  }

  /** Average real worker RSS; starts at the spec's 400 MB until workers report. */
  avgWorkerBytes(): number {
    const sizes = [...this.workerRss.values()].filter(v => v > 0);
    if (!sizes.length) return AVG_WORKER_START;
    return sizes.reduce((a, b) => a + b, 0) / sizes.length;
  }

  reserveBytes(): number {
    return this.number(this.config().resources?.reserveBytes) ?? reserveDefault();
  }

  diskFloorBytes(): number {
    return this.number(this.config().resources?.diskFloorBytes) ?? DISK_FLOOR_DEFAULT;
  }

  diskFreeBytes(): number | undefined { return this.probeResult.diskFree; }
  /** Won't start a worker below the disk floor; the error says why. */
  diskGuardError(): Error | undefined {
    const free = this.diskFreeBytes();
    if (free !== undefined && free < this.diskFloorBytes())
      return new Error(`resources.disk_low: ${Math.floor(free / GB * 10) / 10} GB free, floor is ${Math.floor(this.diskFloorBytes() / GB * 10) / 10} GB`);
    return undefined;
  }

  private profile(): 'laptop' | 'vps' {
    return this.config().machine?.profile === 'vps' ? 'vps' : 'laptop';
  }

  idleTimeoutMs(): number {
    const env = this.number(Number(this.env.ORMICODE_IDLE_TIMEOUT_MS));
    if (env !== undefined) return env;
    const account = this.number(this.account(`idleTimeout.${this.profile()}`));
    if (account !== undefined) return account;
    const machine = this.number(this.config().idleTimeoutMs);
    if (machine !== undefined) return machine;
    return IDLE_DEFAULT[this.profile()];
  }

  private cap(): number {
    const account = this.number(this.account('pool.cap'));
    if (account !== undefined) return Math.floor(account);
    const env = this.number(Number(this.env.ORMICODE_POOL_CAP));
    return env !== undefined ? Math.floor(env) : POOL_CAP_DEFAULT;
  }

  /** Pool size per the spec: (available RAM - reserve) / average worker size. */
  pool(): PoolComputation {
    const { freeRam, totalRam } = this.probeResult;
    const avg = this.avgWorkerBytes();
    const computed = Math.max(1, Math.floor(Math.max(0, freeRam - this.reserveBytes()) / avg));
    const envFixed = this.number(Number(this.env.ORMICODE_POOL_MAX));
    const machineFixed = this.number(this.config().resources?.poolSize);
    const cap = this.cap();
    const onBattery = this.probeResult.onBattery === true;
    const batteryFactor = this.number(this.config().resources?.batteryFactor) ?? 0.5;
    const auto = Math.max(1, Math.floor(computed * (onBattery ? batteryFactor : 1)));
    const effective = envFixed !== undefined ? envFixed : machineFixed !== undefined ? machineFixed : Math.min(auto, cap);
    return {
      mode: envFixed !== undefined || machineFixed !== undefined ? 'fixed' : 'auto',
      computed: Math.min(computed, cap), effective, cap,
      overrides: {
        ...(envFixed !== undefined ? { env: envFixed } : {}),
        ...(machineFixed !== undefined ? { machine: machineFixed } : {}),
        ...(this.account('pool.cap') !== undefined || this.env.ORMICODE_POOL_CAP !== undefined ? { cap } : {}),
      },
    };
  }

  poolSize(): number { return this.pool().effective; }

  /** Per-worker memory cap: half of RAM divided by the warm pool size. */
  workerMemoryCapBytes(): number | undefined {
    const configured = this.number(this.config().resources?.workerMemoryCapBytes);
    if (configured !== undefined) return configured;
    const { totalRam } = this.probeResult;
    const size = this.poolSize();
    return size > 0 ? Math.floor(totalRam / 2 / size) : undefined;
  }

  status() {
    const p = this.pool();
    return {
      sampledAt: this.sampleAt || undefined,
      cpus: this.probeResult.cores,
      totalRam: this.probeResult.totalRam,
      freeRam: this.probeResult.freeRam,
      diskFree: this.probeResult.diskFree,
      onBattery: this.probeResult.onBattery,
      vm: this.probeResult.vm,
      pool: p,
      avgWorkerBytes: this.avgWorkerBytes(),
      workerMemoryCapBytes: this.workerMemoryCapBytes(),
      idleTimeoutMs: this.idleTimeoutMs(),
      diskFloorBytes: this.diskFloorBytes(),
    };
  }
}
