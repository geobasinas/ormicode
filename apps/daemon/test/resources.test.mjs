import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { Resources } from '../src/resources.ts';
import { systemdScopeArgs, overMemoryCap } from '../src/worker-scope.ts';

const GB = 1e9, MB = 1e6;
const RESERVE = platform() === 'win32' ? 3 * GB : 2 * GB;
const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const boot = (probe, opts = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'ormi-resources-')); dirs.push(dir);
  return new Resources({ dir, env: {}, probe, sampleMs: 60_000, ...opts });
};
const probe = (over = {}) => () => ({ totalRam: 16 * GB, freeRam: 8 * GB, cores: 8, diskFree: 100 * GB, onBattery: false, vm: false, ...over });

test('pool size is (available RAM - reserve) / average worker size, capped', () => {
  const r = boot(probe());
  try {
    // 8 GB free - reserve = 5 or 6 GB / 400 MB workers.
    const expected = Math.floor((8 * GB - RESERVE) / (400 * MB));
    assert.equal(r.pool().effective, expected);
    assert.equal(r.pool().mode, 'auto');
    // Workers reporting real RSS shrink or grow the pool.
    r.observeWorker('s1', 800 * MB);
    r.observeWorker('s2', 400 * MB);
    assert.equal(Math.round(r.avgWorkerBytes() / MB), 600);
    assert.equal(r.pool().effective, Math.floor((8 * GB - RESERVE) / (600 * MB)));
    r.forgetWorker('s1'); r.forgetWorker('s2');
    assert.equal(r.avgWorkerBytes(), 400 * MB);
  } finally { r.close(); }
});

test('pool.cap and fixed overrides win over the computed size and are reported', () => {
  const settings = { 'pool.cap': 4 };
  const r = boot(probe(), { readSetting: k => settings[k] });
  try {
    assert.equal(r.pool().effective, 4);
    assert.equal(r.pool().cap, 4);
  } finally { r.close(); }
  const fixed = boot(probe(), { env: { ORMICODE_POOL_MAX: '3' } });
  try {
    assert.equal(fixed.pool().effective, 3);
    assert.equal(fixed.pool().mode, 'fixed');
    assert.equal(fixed.pool().overrides.env, 3);
  } finally { fixed.close(); }
  const dir = mkdtempSync(join(tmpdir(), 'ormi-resources-cfg-')); dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ resources: { poolSize: 6, workerMemoryCapBytes: 1234 } }));
  const machine = new Resources({ dir, env: {}, probe: probe() });
  try {
    assert.equal(machine.pool().effective, 6);
    assert.equal(machine.pool().overrides.machine, 6);
    assert.equal(machine.workerMemoryCapBytes(), 1234);
  } finally { machine.close(); }
});

test('battery halves the auto pool', () => {
  const r = boot(probe({ onBattery: true }));
  try { r.refresh(true); assert.equal(r.pool().effective, Math.floor(Math.floor((8 * GB - RESERVE) / (400 * MB)) / 2)); }
  finally { r.close(); }
});

test('disk guard refuses workers below the floor and says why', () => {
  const r = boot(probe({ diskFree: 2 * GB }));
  try {
    const err = r.diskGuardError();
    assert.match(err.message, /resources\.disk_low/);
    assert.match(err.message, /2 GB free/);
  } finally { r.close(); }
  const fine = boot(probe({ diskFree: 50 * GB }));
  try { assert.equal(fine.diskGuardError(), undefined); } finally { fine.close(); }
});

test('worker memory cap defaults to half of RAM over the pool size', () => {
  const r = boot(probe());
  try {
    const expected = Math.floor((8 * GB - RESERVE) / (400 * MB));
    assert.equal(r.workerMemoryCapBytes(), Math.floor(16 * GB / 2 / expected));
  }
  finally { r.close(); }
});

test('idle timeout follows the machine profile with account and env overrides', () => {
  const laptop = boot(probe());
  try { assert.equal(laptop.idleTimeoutMs(), 20 * 60_000); } finally { laptop.close(); }
  const dir = mkdtempSync(join(tmpdir(), 'ormi-resources-idle-')); dirs.push(dir);
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ machine: { profile: 'vps' } }));
  const vps = new Resources({ dir, env: {}, probe: probe() });
  try { assert.equal(vps.idleTimeoutMs(), 40 * 60_000); } finally { vps.close(); }
  const env = boot(probe(), { env: { ORMICODE_IDLE_TIMEOUT_MS: '5000' } });
  try { assert.equal(env.idleTimeoutMs(), 5000); } finally { env.close(); }
});

test('systemd scope args wrap the worker argv only when a cap exists', () => {
  assert.equal(systemdScopeArgs(undefined, ['node', 'w.ts']), undefined);
  const wrapped = systemdScopeArgs(1234, ['node', 'w.ts']);
  if (wrapped) {
    assert.equal(wrapped.command, 'systemd-run');
    assert.ok(wrapped.args.includes('MemoryMax=1234'));
    assert.deepEqual(wrapped.args.slice(-2), ['node', 'w.ts']);
  }
  // On this platform the probe result is platform-dependent; just check the helper contract.
  assert.equal(overMemoryCap(999, undefined), false);
  assert.equal(overMemoryCap(1001, 1000), true);
});
