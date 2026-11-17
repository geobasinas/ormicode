import { smokeAdapter, reportSmoke } from '@ormicode/agent-core';
import { GrokCliAdapter } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(name);

const code = reportSmoke('grok', 'cli', await smokeAdapter('grok', 'cli', {
  create: hooks => new GrokCliAdapter({ ...(hooks.onNativeId ? { onNativeId: hooks.onNativeId } : {}) }),
  repo: flag('--repo'),
  kill: has('--kill'),
  approve: flag('--approve'),
  keep: has('--keep'),
}));
process.exit(code);
