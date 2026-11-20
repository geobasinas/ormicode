/**
 * `ormi export [file]` and `ormi wipe [--confirm wipe]` (README: Storage and settings).
 * Export reads a consistent store snapshot, so it works with the hub running.
 * Wipe refuses while the hub is running or anything holds the store open.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import * as daemon from '@ormicode/daemon';

const EXPORT_USAGE = 'usage: ormi export [file]';
const WIPE_USAGE = `usage: ormi wipe [--confirm ${daemon.WIPE_CONFIRM}]`;
const home = () => process.env.ORMICODE_HOME ?? join(homedir(), '.ormicode');
const socketPath = () => process.env.ORMICODE_SOCKET ?? daemon.defaultSocketPath();

export function exportCommand(args: string[]): number {
  if (args.length > 1 || args[0]?.startsWith('-')) { console.error(EXPORT_USAGE); return 2; }
  if (!existsSync(home())) { console.error(`nothing to export: ${home()} does not exist`); return 1; }
  const out = resolve(args[0] ?? daemon.exportFileName());
  try {
    const { files } = daemon.writeExport(home(), out);
    console.log(`wrote ${out} (${files.join(', ') || 'manifest only'}; no tokens, no session logs)`);
    return 0;
  } catch (error) { console.error(`export failed: ${(error as Error).message}`); return 1; }
}

async function hubRunning(): Promise<boolean> {
  try { (await daemon.connect(socketPath())).close(); return true; } catch { return false; }
}

async function askConfirmation(): Promise<string> {
  if (!process.stdin.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await rl.question(`Type ${daemon.WIPE_CONFIRM} to delete these permanently: `)).trim(); } finally { rl.close(); }
}

export async function wipeCommand(args: string[]): Promise<number> {
  const at = args.indexOf('--confirm');
  if (args.length !== 0 && (args.length !== 2 || at !== 0)) { console.error(WIPE_USAGE); return 2; }
  if (!existsSync(home())) { console.log(`nothing to wipe: ${home()} does not exist`); return 0; }
  if (await hubRunning()) {
    console.error(`the hub is running on ${socketPath()}; stop it first (or use Settings → Data and privacy). Nothing was deleted.`);
    return 1;
  }
  if (daemon.storeBusy(home())) {
    console.error('the store is open in another process; stop the hub first. Nothing was deleted.');
    return 1;
  }
  console.error(`ormi wipe deletes from ${home()}:\n  ${daemon.WIPE_TARGETS.join(', ')}\nand keeps: ${daemon.WIPE_KEEPS.join(', ')}`);
  const typed = at === 0 ? args[1]! : await askConfirmation();
  if (typed !== daemon.WIPE_CONFIRM) {
    console.error(`confirmation did not match "${daemon.WIPE_CONFIRM}"; nothing was deleted${process.stdin.isTTY ? '' : ` (pass --confirm ${daemon.WIPE_CONFIRM} when not on a terminal)`}`);
    return 1;
  }
  try {
    const { removed, leftover } = daemon.wipeHome(home(), typed);
    console.log(removed.length ? `deleted ${removed.join(', ')}` : 'nothing to delete');
    if (leftover) console.error(`could not finish removing ${leftover}; delete it by hand`);
    return 0;
  } catch (error) { console.error(`wipe failed: ${(error as Error).message}`); return 1; }
}
