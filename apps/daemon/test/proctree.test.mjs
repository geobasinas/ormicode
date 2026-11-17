import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killTree } from '../src/proctree.ts';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('killTree reaps a worker and its grandchild', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proctree-'));
  const file = join(dir, 'gcpid.txt');
  // The "worker" spawns a detached grandchild that writes its pid and sleeps.
  const worker = spawn(process.execPath, ['-e',
    `const {spawn}=require('child_process');const fs=require('fs');
     const g=spawn(process.execPath,['-e','setInterval(()=>{},1e9)'],{detached:true,stdio:'ignore'});
     g.unref(); fs.writeFileSync(process.argv[1],String(g.pid)); setInterval(()=>{},1e9);`,
    file], { detached: process.platform !== 'win32', stdio: 'ignore' });
  try {
    let gcpid;
    for (let i = 0; i < 100 && !gcpid; i++) {
      await new Promise(r => setTimeout(r, 50));
      try { gcpid = Number(readFileSync(file, 'utf8')); } catch { /* not yet */ }
    }
    assert.ok(gcpid, 'grandchild started');
    assert.ok(alive(worker.pid) && alive(gcpid));
    killTree(worker);
    await new Promise(r => setTimeout(r, 1500));
    assert.ok(!alive(worker.pid), 'worker dead');
    assert.ok(!alive(gcpid), 'grandchild dead');
  } finally {
    try { killTree(worker); } catch { /* already dead */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
