import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const onPath = (cmd: string) => { try { execFileSync('where', [cmd], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } };

/** Windows: PowerShell 7 → Windows PowerShell → cmd.exe. Elsewhere: $SHELL → /bin/bash → /bin/sh. */
export function defaultShell(): string {
  if (cached) return cached;
  if (process.platform === 'win32') cached = onPath('pwsh.exe') ? 'pwsh.exe' : onPath('powershell.exe') ? 'powershell.exe' : 'cmd.exe';
  else {
    const sh = process.env.SHELL;
    cached = sh && existsSync(sh) ? sh : existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  }
  return cached;
}
let cached: string | undefined;

export function brokerSocketPath(home: string): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\ormicode-pty-${Buffer.from(home).toString('hex').slice(-16)}` : `${home}/pty.sock`;
}
