// Machine config from ~/.ormicode/config.json. Machine-scope keys only —
// anything account-scoped lives in the store's `settings` table instead.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ormicodeDir } from './socket.ts';

export interface MachineConfig {
  machine?: { id?: string; name?: string; profile?: 'laptop' | 'vps' };
  resources?: {
    poolSize?: number;
    workerMemoryCapBytes?: number;
    reserveBytes?: number;
    diskFloorBytes?: number;
    batteryFactor?: number;
  };
  idleTimeoutMs?: number;
}

/** Re-read on every call: the file is tiny and edits should apply without a restart. */
export function loadMachineConfig(dir: string = ormicodeDir()): MachineConfig {
  try {
    const path = join(dir, 'config.json');
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as MachineConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
