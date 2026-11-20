#!/usr/bin/env node
import { usage } from './usage.ts';
import { agentSmoke } from './smoke.ts';
import { daemonMain, statusMain, pairMain, connectMain, devicesMain, relayMain } from './daemon.ts';
import { sessionCommand } from './session.ts';
import { checkpointCommand } from './checkpoint.ts';
import { fileCommand } from './file.ts';
import { projectCommand } from './project.ts';
import { secretCommand } from './secret.ts';
import { costCommand, pricingCommand } from './pricing.ts';
import { modelsCommand } from './models.ts';
import { attachSession } from './attach.ts';
import { withDaemon } from './daemon.ts';
import { newId } from '@ormicode/protocol';
import { flag } from './usage.ts';
import { serviceCommand, previewCommand } from './service.ts';
import { designCommand } from './design.ts';
import { browserCommand } from './browser.ts';

const [group, command, ...rest] = process.argv.slice(2);
if (group === 'agent' && command === 'smoke') {
  const vendor = rest[0];
  if (!vendor || vendor.startsWith('--')) usage(2);
  process.exit(await agentSmoke(vendor, rest.slice(1)));
} else if (group === 'daemon' && !command) {
  process.exit(await daemonMain());
} else if (group === 'session' && command) {
  process.exit(await sessionCommand(command, rest));
} else if (group === 'pricing') {
  process.exit(await pricingCommand(command, rest));
} else if (group === 'models') {
  process.exit(await modelsCommand(command ? [command, ...rest] : []));
} else if (group === 'cost') {
  process.exit(await costCommand(command, rest));
} else if (group === 'secret') {
  process.exit(await secretCommand(command, rest));
} else if (group === 'checkpoint') {
  process.exit(await checkpointCommand(command, rest));
} else if (group === 'file') {
  process.exit(await fileCommand(command, rest));
} else if (group === 'design') {
  process.exit(await designCommand(command, rest));
} else if (group === 'project') {
  process.exit(await projectCommand(command, rest));
} else if (group === 'service') {
  process.exit(await serviceCommand(command, rest));
} else if (group === 'preview') {
  process.exit(await previewCommand(command, rest));
} else if (group === 'browser') {
  process.exit(await browserCommand(command, rest));
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
  // ormi run <vendor> [--transport t] [--model m] [--effort e] [--mode m] [-- agent args…]
  const sep = rest.indexOf('--');
  const cliFlags = sep < 0 ? rest : rest.slice(0, sep);
  const agentArgs = sep < 0 ? [] : rest.slice(sep + 1);
  if (sep < 0 && cliFlags.some(a => !a.startsWith('--')))
    console.error('note: bare agent args need `-- ` first, e.g. `ormi run claude -- --verbose`');
  process.exit(await withDaemon(async link => {
    const res = await link.request('session.start', {
      machine: newId('m'), project: process.cwd(), vendor: command,
      transport: flag(cliFlags, '--transport') ?? 'cli',
      model: flag(cliFlags, '--model') ?? 'default', effort: flag(cliFlags, '--effort') ?? 'default',
      mode: flag(cliFlags, '--mode') ?? 'default', workspace: { kind: 'current' },
      agentArgs,
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
