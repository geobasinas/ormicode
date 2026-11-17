import { smokeAdapter, reportSmoke } from '@ormicode/agent-core';
import { PiCliAdapter } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(name);

const code = reportSmoke('pi', 'cli', await smokeAdapter('pi', 'cli', {
  create: hooks => new PiCliAdapter({ ...(hooks.onNativeId ? { onNativeId: hooks.onNativeId } : {}) }),
  repo: flag('--repo'),
  home: flag('--home'),
  kill: has('--kill'),
  approve: flag('--approve'),
  toolPrompt: flag('--tool-prompt'),
  keep: has('--keep'),
}));
process.exit(code);
