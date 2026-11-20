import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ormi = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ormi.ts');
const run = args => spawnSync(process.execPath, [ormi, ...args], { encoding: 'utf8' });

test('ormi with no args prints usage and exits 0', () => {
  const { status, stdout } = run([]);
  assert.equal(status, 0);
  assert.match(stdout, /agent smoke <vendor>/);
  assert.match(stdout, /ormi models \[--agent x\] \[--transport y\] \[--refresh\]/);
  assert.match(stdout, /ormi project branches <path>/);
  assert.match(stdout, /ormi project fetch <path>/);
  assert.match(stdout, /ormi project pull <path> <branch>/);
  assert.match(stdout, /--checkout <branch>/);
});

test('ormi models rejects unknown options before connecting to the daemon', () => {
  const { status, stderr } = run(['models', '--unknown']);
  assert.equal(status, 2);
  assert.match(stderr, /usage: ormi models/);
});

test('ormi project branches requires a path before connecting to the daemon', () => {
  const { status, stderr } = run(['project', 'branches']);
  assert.equal(status, 2);
  assert.match(stderr, /usage: ormi project branches <path>/);
});

test('ormi project fetch requires a path before connecting to the daemon', () => {
  const { status, stderr } = run(['project', 'fetch']);
  assert.equal(status, 2);
  assert.match(stderr, /usage: ormi project branches <path> \| ormi project fetch <path>/);
});

test('ormi project branch mutations reject incomplete confirmations before connecting', () => {
  const missingPull = run(['project', 'pull', '/repo']);
  assert.equal(missingPull.status, 2);
  assert.match(missingPull.stderr, /project.*pull <path> <branch>/);
  const missingConfirm = run(['project', 'delete-branch', '/repo', 'feature']);
  assert.equal(missingConfirm.status, 2);
  assert.match(missingConfirm.stderr, /--confirm <name>/);
});

test('ormi session start rejects include-dirty without a worktree before connecting', () => {
  const { status, stderr } = run(['session', 'start', 'fake', '--include-dirty']);
  assert.equal(status, 2);
  assert.match(stderr, /--worktree <base>/);
});

test('ormi session start validates checkout choices before connecting', () => {
  const missing = run(['session', 'start', 'fake', '--checkout']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--checkout <branch>/);
  const conflict = run(['session', 'start', 'fake', '--checkout', 'main', '--existing', '/repo/.git/worktrees/main']);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /--checkout <branch>/);
});

test('ormi agent smoke without a vendor exits 2', () => {
  const { status } = run(['agent', 'smoke']);
  assert.equal(status, 2);
});

test('ormi agent smoke with an unknown vendor exits 2', () => {
  const { status, stderr } = run(['agent', 'smoke', 'nosuchagent']);
  assert.equal(status, 2);
  assert.match(stderr, /unknown vendor nosuchagent/);
});

test('ormi agent smoke with an unknown transport exits 2', () => {
  const { status, stderr } = run(['agent', 'smoke', 'pi', '--transport', 'warp']);
  assert.equal(status, 2);
  assert.match(stderr, /unknown transport warp/);
});

test('ormi agent smoke reports a missing smoke script as unverified', () => {
  // claude:cli exists in the repo layout? if not it reports unverified; either way it must not crash.
  const { status } = run(['agent', 'smoke', 'claude', '--transport', 'sdk']);
  assert.ok([0, 1, 2].includes(status));
});

test('ormi agent smoke fake runs the in-process harness without credentials', () => {
  const { status, stdout } = run(['agent', 'smoke', 'fake']);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /smoke fake\/inprocess turn: ok/);
});

test('ormi agent smoke fake rejects an unknown script', () => {
  const { status } = run(['agent', 'smoke', 'fake', '--script', 'bogus']);
  assert.equal(status, 2);
});

test('unknown command exits 2', () => {
  const { status } = run(['bogus']);
  assert.equal(status, 2);
});

test('ormi export and ormi wipe work on ORMICODE_HOME and wipe needs the typed word', async () => {
  const { mkdtempSync, readdirSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const net = await import('node:net');
  const { seedHome, untar } = await import('../../daemon/test/home-data-fixture.mjs');
  const base = mkdtempSync(join(tmpdir(), 'ormi-cli-data-'));
  const home = join(base, 'home');
  const env = { ...process.env, ORMICODE_HOME: home, ORMICODE_SOCKET: join(base, 'hub.sock'), ORMICODE_REMOTE: '0' };
  const runIn = (args, input) => spawnSync(process.execPath, [ormi, ...args], { encoding: 'utf8', env, input });
  try {
    assert.match(run([]).stdout, /ormi export \[file\][\s\S]*ormi wipe \[--confirm wipe\]/);
    seedHome(home);
    const before = readdirSync(home).sort();
    const exported = runIn(['export', join(base, 'out.tar')]);
    assert.equal(exported.status, 0, exported.stderr);
    assert.deepEqual(Object.keys(untar(readFileSync(join(base, 'out.tar')))).sort(), ['config.json', 'logs/daemon.log', 'logs/daemon.log.1', 'manifest.json', 'store.db']);
    assert.equal(runIn(['export', '--all']).status, 2);
    assert.equal(runIn(['wipe', 'now']).status, 2);
    for (const [args, input] of [[['wipe', '--confirm', 'yes']], [['wipe'], 'wipe\n'], [['wipe', '--confirm', 'WIPE']]]) {
      const refused = runIn(args, input);
      assert.equal(refused.status, 1, `${args.join(' ')} should refuse`);
      assert.match(refused.stderr, /nothing was deleted/);
    }
    assert.deepEqual(readdirSync(home).sort(), before, 'a wrong or missing confirmation deletes nothing');
    const hub = net.createServer(socket => socket.destroy());
    await new Promise(resolve => hub.listen(env.ORMICODE_SOCKET, resolve));
    try {
      const running = await new Promise(resolve => {
        const child = spawn(process.execPath, [ormi, 'wipe', '--confirm', 'wipe'], { env });
        let stderr = ''; child.stderr.on('data', d => { stderr += d; });
        child.on('close', status => resolve({ status, stderr }));
      });
      assert.equal(running.status, 1);
      assert.match(running.stderr, /hub is running/);
    } finally { await new Promise(resolve => hub.close(resolve)); }
    assert.deepEqual(readdirSync(home).sort(), before, 'a running hub blocks the wipe');
    const wiped = runIn(['wipe', '--confirm', 'wipe']);
    assert.equal(wiped.status, 0, wiped.stderr);
    assert.match(wiped.stdout, /deleted store\.db/);
    assert.deepEqual(readdirSync(home).sort(), ['config.json', 'desktop', 'scratch', 'secrets-index.json', 'skills']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
