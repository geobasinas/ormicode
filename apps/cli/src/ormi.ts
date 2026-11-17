#!/usr/bin/env node
import { usage } from './usage.ts';
import { agentSmoke } from './smoke.ts';
import { daemonMain, statusMain } from './daemon.ts';
import { sessionCommand } from './session.ts';

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
} else if (!group || group === '--help' || group === '-h') usage(0);
else { console.error(`unknown command ${[group, command].filter(Boolean).join(' ')}`); usage(2); }
