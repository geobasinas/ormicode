#!/usr/bin/env node
import { usage } from './usage.ts';
import { agentSmoke } from './smoke.ts';
import { daemonMain, statusMain, pairMain, connectMain, devicesMain, relayMain } from './daemon.ts';
import { sessionCommand } from './session.ts';
import { attachSession } from './attach.ts';
import { withDaemon } from './daemon.ts';
import { newId } from '@ormicode/protocol';
import { flag } from './usage.ts';

const [group, command, ...rest] = process.argv.slice(2);
if (group === 'agent' && command === 'smoke') {
  const vendor = rest[0];
  if (!vendor || vendor.startsWith('--')) usage(2);
  process.exit(await agentSmoke(vendor, rest.slice(1)));
} else if (group === 'daemon' && !command) {
  process.exit(await daemonMain());
} else if (group === 'session' && command) {
  process.exit(await sessionCommand(command, rest));
} else if (group === 'status' && !command) {
  process.exit(await statusMain());
} else if (group === 'pair' && !command) {
  process.exit(await pairMain());
} else if (group === 'connect' && command) {
  process.exit(await connectMain([command, ...rest]));
} else if (group === 'relay') {
  process.exit(await relayMain(command ? [command, ...rest] : []));
} else if (group === 'attach' && command) {
  process.exit(await withDaemon(link => attachSession(link, command)));
} else if (group === 'run' && command) {
  // ormi run <vendor> [--transport t] [agent args...]: start + attach.
  process.exit(await withDaemon(async link => {
    const res = await link.request('session.start', {
      machine: newId('m'), project: process.cwd(), vendor: command,
      transport: flag(rest, '--transport') ?? 'cli',
      model: flag(rest, '--model') ?? 'default', effort: flag(rest, '--effort') ?? 'default',
      mode: flag(rest, '--mode') ?? 'default', workspace: { kind: 'current' },
      agentArgs: rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--transport' && rest[i - 1] !== '--model' && rest[i - 1] !== '--effort' && rest[i - 1] !== '--mode'),
    });
    if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
    const session = (res.body as { session: string }).session;
    console.log(`session ${session} — Ctrl+] to detach`);
    return attachSession(link, session);
  }));
} else if (group === 'devices') {
  process.exit(await devicesMain(command ? [command, ...rest] : []));
} else if (!group || group === '--help' || group === '-h') usage(0);
else { console.error(`unknown command ${[group, command].filter(Boolean).join(' ')}`); usage(2); }
