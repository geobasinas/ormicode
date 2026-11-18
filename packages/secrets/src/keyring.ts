// OS keyring access. Values go in and out over stdin/stdout of the platform
// tool and are only ever held in memory. Entries: service "ormicode",
// account "<scope>:<NAME>" where scope is "machine" or "project:<abs path>".
import { execFileSync } from 'node:child_process';

export interface Keyring { readonly kind: string; get(account: string): string | undefined; set(account: string, value: string): void; delete(account: string): void }

export class KeyringUnavailable extends Error { readonly code = 'secrets.unavailable'; }

const SERVICE = 'ormicode';
const run = (cmd: string, args: string[], input?: string) =>
  execFileSync(cmd, args, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'] });

class SecretTool implements Keyring {
  readonly kind = 'libsecret';
  get(account: string) { try { const v = run('secret-tool', ['lookup', 'service', SERVICE, 'account', account]); return v === '' ? undefined : v; } catch { return undefined; } }
  set(account: string, value: string) { run('secret-tool', ['store', '--label', `ormicode ${account}`, 'service', SERVICE, 'account', account], value); }
  delete(account: string) { try { run('secret-tool', ['clear', 'service', SERVICE, 'account', account]); } catch { /* absent */ } }
}

class MacKeychain implements Keyring {
  readonly kind = 'keychain';
  get(account: string) { try { return run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']).replace(/\n$/, ''); } catch { return undefined; } }
  // `security -w` with no value prompts on stdin, so the value never appears in argv.
  set(account: string, value: string) { run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w'], `${value}\n${value}\n`); }
  delete(account: string) { try { run('security', ['delete-generic-password', '-s', SERVICE, '-a', account]); } catch { /* absent */ } }
}

/** In-memory keyring for tests (ORMICODE_KEYRING=memory). */
export class MemoryKeyring implements Keyring {
  readonly kind = 'memory';
  private readonly values = new Map<string, string>();
  get(account: string) { return this.values.get(account); }
  set(account: string, value: string) { this.values.set(account, value); }
  delete(account: string) { this.values.delete(account); }
}

const has = (cmd: string) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

export function systemKeyring(): Keyring {
  if (process.env.ORMICODE_KEYRING === 'memory') return new MemoryKeyring();
  if (process.platform === 'darwin') return new MacKeychain();
  if (process.platform === 'linux' && has('secret-tool')) return new SecretTool();
  return { kind: 'none', get: () => undefined,
    set: () => { throw new KeyringUnavailable(process.platform === 'linux' ? 'install libsecret-tools (secret-tool) to store secrets' : `no keyring backend for ${process.platform} yet`); },
    delete: () => undefined };
}

export const account = (name: string, project?: string) => (project ? `project:${project}:${name}` : `machine:${name}`);
