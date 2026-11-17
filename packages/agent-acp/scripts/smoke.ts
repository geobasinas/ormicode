import { smokeAdapter, reportSmoke } from '@ormicode/agent-core';
import { AcpAdapter } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(name);
const command = flag('--command') ?? process.env.ORMICODE_ACP_COMMAND;
const vendor = flag('--vendor') ?? 'acp';
if (!command) { console.error('smoke: set --command or ORMICODE_ACP_COMMAND'); process.exit(1); }
const cmdArgs = (flag('--args') ?? process.env.ORMICODE_ACP_ARGS ?? '').split(' ').filter(Boolean);

const code = reportSmoke(vendor, 'acp', await smokeAdapter(vendor, 'acp', {
  create: hooks => new AcpAdapter({ vendor, command: command!, args: cmdArgs, preferV1: has('--v1'), ...(hooks.onNativeId ? { onNativeId: hooks.onNativeId } : {}) }),
  repo: flag('--repo'),
  home: flag('--home'),
  kill: has('--kill'),
  approve: flag('--approve'),
  keep: has('--keep'),
}));
process.exit(code);
