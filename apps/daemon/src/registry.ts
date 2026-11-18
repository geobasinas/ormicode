import type { AgentAdapter } from '@ormicode/agent-core';
import { FakeAdapter } from '@ormicode/agent-core';

/** vendor/transport -> adapter package + class. `acp` is the generic third-party client. */
const REGISTRY: Record<string, { pkg: string; cls: string }> = {
  'claude/sdk': { pkg: '@ormicode/agent-claude-sdk', cls: 'ClaudeSdkAdapter' },
  'claude/cli': { pkg: '@ormicode/agent-claude-cli', cls: 'ClaudeCliAdapter' },
  'codex/sdk': { pkg: '@ormicode/agent-codex-sdk', cls: 'CodexSdkAdapter' },
  'codex/cli': { pkg: '@ormicode/agent-codex-cli', cls: 'CodexCliAdapter' },
  'grok/acp': { pkg: '@ormicode/agent-grok-acp', cls: 'GrokAcpAdapter' },
  'grok/cli': { pkg: '@ormicode/agent-grok-cli', cls: 'GrokCliAdapter' },
  'opencode/acp': { pkg: '@ormicode/agent-opencode-acp', cls: 'OpenCodeAcpAdapter' },
  'opencode/cli': { pkg: '@ormicode/agent-opencode-cli', cls: 'OpenCodeCliAdapter' },
  'opencode/sdk': { pkg: '@ormicode/agent-opencode-sdk', cls: 'OpenCodeSdkAdapter' },
  'pi/cli': { pkg: '@ormicode/agent-pi-cli', cls: 'PiCliAdapter' },
  'pi/sdk': { pkg: '@ormicode/agent-pi-sdk', cls: 'PiSdkAdapter' },
  'vibe/acp': { pkg: '@ormicode/agent-vibe-acp', cls: 'VibeAcpAdapter' },
  'vibe/cli': { pkg: '@ormicode/agent-vibe-cli', cls: 'VibeCliAdapter' },
};

/** vendor -> transports with an adapter, in registry order; `fake` is the test agent. */
export function agentList(): { vendor: string; transports: string[] }[] {
  const by = new Map<string, string[]>();
  for (const key of Object.keys(REGISTRY)) {
    const [vendor, transport] = key.split('/') as [string, string];
    by.set(vendor, [...(by.get(vendor) ?? []), transport]);
  }
  return [...by.entries(), ['fake', ['cli']] as [string, string[]]].map(([vendor, transports]) => ({ vendor, transports }));
}

export function hasTransport(vendor: string, transport: string): boolean {
  return vendor === 'fake' || vendor === 'acp' || Boolean(REGISTRY[`${vendor}/${transport}`]);
}

// Transports whose native resume passed `ormi agent smoke`. Static so the
// supervisor can plan restart recovery without spawning adapter modules.
const RESUMABLE = new Set([
  'claude/sdk', 'claude/cli', 'codex/sdk', 'codex/cli', 'grok/cli', 'grok/acp',
  'opencode/cli', 'opencode/sdk', 'opencode/acp', 'pi/cli', 'pi/sdk', 'vibe/acp',
  // The deterministic fake implements a no-op resume to drive restart tests.
  'fake/cli',
]);
export function resumable(vendor: string, transport: string): boolean {
  return RESUMABLE.has(`${vendor}/${transport}`);
}

export async function createAdapter(vendor: string, transport: string, opts: {
  agentCommand?: string; agentArgs?: string[]; onNativeId?: (id: string) => void;
}): Promise<AgentAdapter> {
  if (vendor === 'fake') return new FakeAdapter();
  if (vendor === 'acp') {
    const mod = await import('@ormicode/agent-acp') as unknown as Record<string, new (o: object) => AgentAdapter>;
    return new mod.AcpAdapter({ command: opts.agentCommand ?? '', args: opts.agentArgs ?? [], ...(opts.onNativeId ? { onNativeId: (_h: unknown, id: string) => opts.onNativeId!(id) } : {}) });
  }
  const entry = REGISTRY[`${vendor}/${transport}`];
  if (!entry) throw new Error(`no adapter for ${vendor}/${transport}`);
  const mod = await import(entry.pkg) as unknown as Record<string, new (o: object) => AgentAdapter>;
  const Ctor = mod[entry.cls];
  if (!Ctor) throw new Error(`${entry.pkg} does not export ${entry.cls}`);
  return new Ctor(opts.onNativeId ? { onNativeId: (_h: unknown, id: string) => opts.onNativeId!(id) } : {});
}
