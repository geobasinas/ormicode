import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { stopWorkerProcess } from '../src/stop-worker.ts';
import { killTree } from '../src/proctree.ts';

test('Stop kills a worker and its detached running command without waiting for adapter cooperation', { timeout: 10_000 }, async () => {
  const worker = spawn(process.execPath, ['-e', `
    const {spawn}=require('node:child_process');
    const command=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    command.on('spawn',()=>console.log(command.pid));
    setInterval(()=>{},1000);
  `], { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  let command;
  try {
    command = Number(String((await once(worker.stdout, 'data'))[0]).trim());
    assert.ok(command > 0);
    process.kill(command, 0);
    await stopWorkerProcess(worker, { request() { assert.fail('Stop must not wait for a stuck SDK or tool'); } }, 's', true);
    assert.notEqual(worker.signalCode ?? worker.exitCode, null);
    // Reparented children may briefly be zombies until the OS reaps them.
    if (process.platform === 'linux') {
      let state;
      try { state = readFileSync(`/proc/${command}/stat`, 'utf8').split(') ')[1][0]; } catch { state = 'gone'; }
      assert.ok(state === 'Z' || state === 'gone', `command is still running (${state})`);
    } else assert.throws(() => process.kill(command, 0));
  } finally { killTree(worker); if (command) { try { process.kill(command, 'SIGKILL'); } catch { /* already gone */ } } }
});

test('ordinary eviction still asks the adapter to shut down gracefully', async () => {
  let method;
  await stopWorkerProcess({}, { async request(value) { method = value; } }, 's', false);
  assert.equal(method, 'worker.evict');
});
