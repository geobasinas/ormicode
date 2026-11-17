#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const transports: Record<string, string[]> = {
  claude: ['sdk', 'cli'],
  codex: ['sdk'],
  opencode: ['sdk', 'cli', 'acp'],
  pi: ['sdk', 'cli'],
  grok: ['cli', 'acp'],
  vibe: ['cli', 'acp'],
};

function usage(code: number): never {
  console.log(`usage:
  ormi agent smoke <vendor> [--transport sdk|cli|acp] [--repo <dir>] [--home <dir>] [--kill] [--approve <optionId>] [--keep]
  ormi agent smoke <vendor> --command <acp-cmd> [--args "..."]   (third-party ACP agent)`);
  process.exit(code);
}

const passthrough = ['--repo', '--home', '--approve', '--command', '--args', '--vendor', '--v1'];
const flags = ['--kill', '--keep'];

function forward(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flags.includes(arg)) out.push(arg);
    else if (passthrough.includes(arg)) { out.push(arg); if (args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[++i]); }
  }
  return out;
}

async function runScript(script: string, extra: string[]): Promise<number> {
  if (!existsSync(script)) { console.log(`smoke: no smoke script at ${script} (unverified)`); return -1; }
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...extra], { stdio: 'inherit', cwd: root, windowsHide: true, shell: false });
    child.on('error', () => resolve(1));
    child.on('close', code => resolve(code ?? 1));
  });
}

async function agentSmoke(vendor: string, args: string[]): Promise<number> {
  // The fake adapter runs in-process: no vendor binary or credentials needed.
  if (vendor === 'fake') {
    const { FakeAdapter, smokeAdapter, reportSmoke } = await import('@ormicode/agent-core');
    const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    const script = flag('--script');
    if (script && !['echo', 'slow', 'tool', 'approval', 'ratelimit'].includes(script)) { console.error(`unknown fake script ${script}`); return usage(2); }
    const code = reportSmoke('fake', 'inprocess', await smokeAdapter('fake', 'inprocess', {
      create: () => new FakeAdapter({ ...(script ? { script: script as 'echo' | 'slow' | 'tool' | 'approval' | 'ratelimit' } : {}) }),
      repo: flag('--repo'),
      kill: args.includes('--kill'),
      approve: flag('--approve'),
      keep: args.includes('--keep'),
      timeoutMs: 10_000,
    }));
    return code;
  }
  const ti = args.indexOf('--transport');
  const wanted = ti >= 0 ? args[ti + 1] : undefined;
  if (wanted && !['sdk', 'cli', 'acp'].includes(wanted)) { console.error(`unknown transport ${wanted}`); return usage(2); }
  const rest = forward(args.filter((_, i) => i !== ti && i !== ti + 1));

  // Third-party agents go through the generic ACP smoke when a command is given.
  if (args.includes('--command') || (!transports[vendor] && process.env.ORMICODE_ACP_COMMAND)) {
    return runScript(join(root, 'packages/agent-acp/scripts/smoke.ts'), ['--vendor', vendor, ...rest]);
  }
  const list = (transports[vendor] ?? []).filter(t => !wanted || t === wanted);
  if (!list.length) { console.error(`unknown vendor ${vendor} (known: ${Object.keys(transports).join(', ')}, or pass --command for a third-party ACP agent)`); return usage(2); }

  let failed = 0; let missing = 0;
  for (const transport of list) {
    const code = await runScript(join(root, `packages/agent-${vendor}-${transport}/scripts/smoke.ts`), rest);
    if (code === -1) missing++;
    else if (code !== 0) failed++;
  }
  if (missing === list.length) { console.log(`smoke ${vendor}: no transports implemented`); return 2; }
  console.log(`smoke ${vendor}: ${failed ? `${failed} transport(s) failed` : 'all implemented transports passed'}${missing ? `, ${missing} missing` : ''}`);
  return failed ? 1 : 0;
}

const [group, command, ...rest] = process.argv.slice(2);
if (group === 'agent' && command === 'smoke') {
  const vendor = rest[0];
  if (!vendor || vendor.startsWith('--')) usage(2);
  process.exit(await agentSmoke(vendor, rest.slice(1)));
} else if (!group || group === '--help' || group === '-h') usage(0);
else { console.error(`unknown command ${[group, command].filter(Boolean).join(' ')}`); usage(2); }
