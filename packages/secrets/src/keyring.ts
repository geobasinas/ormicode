// OS keyring access. Values go in and out over stdin/stdout of the platform
// tool and are only ever held in memory. Entries: service "ormicode",
// account "<scope>:<NAME>" where scope is "machine" or "project:<abs path>".
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Keyring { readonly kind: string; readonly message?: string; get(account: string): string | undefined; set(account: string, value: string): void; delete(account: string): void }

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

/**
 * Windows backend: DPAPI (CurrentUser scope) through PowerShell. Values are
 * encrypted with the logged-in user's key before touching disk; only the
 * ciphertext map lives in ~/.ormicode/secrets.dpapi.json. PowerShell is used
 * rather than Credential Manager because generic-credential reads aren't
 * exposed by any built-in CLI, and DPAPI is the same per-user protection.
 */
export class WindowsDpapi implements Keyring {
  readonly kind = 'dpapi';
  private readonly file: string;
  constructor(file: string) { this.file = file; }

  private ps(script: string, input: string): string {
    return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], input);
  }

  private load(): Record<string, string> {
    try { return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>; }
    catch { return {}; }
  }
  private save(map: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(map), { mode: 0o600 });
  }

  private static readonly PROTECT =
    "Add-Type -AssemblyName System.Security; " +
    "$in=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($in); " +
    "$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); " +
    "[Console]::Out.Write([Convert]::ToBase64String($p))";
  private static readonly UNPROTECT =
    "Add-Type -AssemblyName System.Security; " +
    "$in=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($in); " +
    "$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); " +
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))";

  get(account: string): string | undefined {
    const blob = this.load()[account];
    if (!blob) return undefined;
    try { const v = this.ps(WindowsDpapi.UNPROTECT, blob); return v === '' ? undefined : v; }
    catch { return undefined; }
  }
  set(account: string, value: string): void {
    const blob = this.ps(WindowsDpapi.PROTECT, value).trim();
    const map = this.load();
    map[account] = blob;
    this.save(map);
  }
  delete(account: string): void {
    const map = this.load();
    if (!(account in map)) return;
    delete map[account];
    this.save(map);
  }
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
  if (process.env.ORMICODE_KEYRING === 'dpapi' && process.platform === 'win32')
    return new WindowsDpapi(join(process.env.ORMICODE_HOME ?? join(homedir(), '.ormicode'), 'secrets.dpapi.json'));
  if (process.platform === 'darwin') return new MacKeychain();
  if (process.platform === 'linux' && has('secret-tool')) return new SecretTool();
  if (process.platform === 'win32' && has('powershell'))
    return new WindowsDpapi(join(process.env.ORMICODE_HOME ?? join(homedir(), '.ormicode'), 'secrets.dpapi.json'));
  const message = process.platform === 'linux' ? 'Install libsecret-tools (secret-tool) to store secrets.' : `No keyring backend for ${process.platform} yet.`;
  return { kind: 'none', message, get: () => undefined,
    set: () => { throw new KeyringUnavailable(message); },
    delete: () => undefined };
}

export const account = (name: string, project?: string) => (project ? `project:${project}:${name}` : `machine:${name}`);
