// Account settings over the wire. Only keys the hub actually reads are listed,
// so every value the client can change has an effect without a restart.
import { clearSetting, setSetting, settingValue } from '@ormicode/session-store';
import { agentList } from './registry.ts';
import { loadMachineConfig } from './machine-config.ts';
import type { Client, DispatchCtx } from './dispatch.ts';

type Spec = { kind: 'int' | 'number'; default: number; min: number; max: number } | { kind: 'agent'; default: string };
const MINUTE = 60_000;

export const SETTINGS: Record<string, Spec> = {
  'idleTimeout.laptop': { kind: 'int', default: 20 * MINUTE, min: MINUTE, max: 24 * 60 * MINUTE },
  'idleTimeout.vps': { kind: 'int', default: 40 * MINUTE, min: MINUTE, max: 24 * 60 * MINUTE },
  'pool.cap': { kind: 'int', default: 20, min: 1, max: 64 },
  'utility.agent': { kind: 'agent', default: 'default' },
  'utility.dailyCapUsd': { kind: 'number', default: 1, min: 0, max: 100 },
  'team.children': { kind: 'int', default: 4, min: 1, max: 8 },
  'team.childrenMax': { kind: 'int', default: 8, min: 1, max: 8 },
  'team.depth': { kind: 'int', default: 2, min: 1, max: 5 },
  'team.concurrent': { kind: 'int', default: 3, min: 1, max: 8 },
  'team.maxTeams': { kind: 'int', default: 3, min: 1, max: 10 },
  'team.silenceMs': { kind: 'int', default: 10 * MINUTE, min: MINUTE, max: 6 * 60 * MINUTE },
};

function agentChoices(): string[] {
  return agentList().filter(a => a.vendor !== 'fake').flatMap(a => a.transports.map(t => `${a.vendor}/${t}`));
}

/** Returns the error message for a bad value, or undefined when it is valid. */
export function settingError(key: string, value: unknown): string | undefined {
  const spec = SETTINGS[key];
  if (!spec) return `unknown setting ${key}`;
  if (spec.kind === 'agent')
    return value === 'default' || (typeof value === 'string' && agentChoices().includes(value)) ? undefined : `${key} must be "default" or an installed vendor/transport`;
  if (typeof value !== 'number' || !Number.isFinite(value) || (spec.kind === 'int' && !Number.isSafeInteger(value))) return `${key} must be ${spec.kind === 'int' ? 'an integer' : 'a number'}`;
  return value < spec.min || value > spec.max ? `${key} must be between ${spec.min} and ${spec.max}` : undefined;
}

function entry(ctx: DispatchCtx, key: string) {
  const spec = SETTINGS[key]!;
  const stored = settingValue(ctx.db, key);
  const valid = stored !== undefined && settingError(key, stored) === undefined;
  return {
    key, value: valid ? stored : spec.default, default: spec.default, set: valid,
    ...(spec.kind === 'agent' ? { choices: ['default', ...agentChoices()] } : { min: spec.min, max: spec.max }),
  };
}

export function settingsMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): void {
  if (method === 'settings.get') {
    const profile = loadMachineConfig().machine?.profile === 'vps' ? 'vps' : 'laptop';
    return client.link.reply(id, { profile, settings: Object.keys(SETTINGS).map(key => entry(ctx, key)) });
  }
  const key = String(body.key);
  if (body.value === null) {
    if (!SETTINGS[key]) return client.link.replyError(id, 'protocol.invalid_frame', `unknown setting ${key}`);
    clearSetting(ctx.db, key);
    return client.link.reply(id, entry(ctx, key));
  }
  const error = settingError(key, body.value);
  if (error) return client.link.replyError(id, 'protocol.invalid_frame', error);
  setSetting(ctx.db, key, body.value);
  return client.link.reply(id, entry(ctx, key));
}
