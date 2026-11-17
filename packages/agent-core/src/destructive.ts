// Destructive-command classification, per the README's "Destructive commands"
// list. The pattern file is ~/.ormicode/destructive.json:
//   {"version":1,"patterns":[{"kind":"prefix","value":"rm -rf"}]}
// A missing or broken file falls back to the built-in defaults below. Matching
// is case-insensitive, whitespace-collapsed, applied per command segment
// (split on &&, ||, ;, |, newlines) and inside $(...) / `...` substitutions.
import { readFileSync } from 'node:fs';

export interface DestructivePattern { kind: 'prefix' | 'regex'; value: string }
export interface DestructiveHit { rule: string; segment: string }

export const DEFAULT_PATTERNS: readonly DestructivePattern[] = Object.freeze([
  // Filesystem
  { kind: 'prefix', value: 'rm -rf' }, { kind: 'prefix', value: 'rm -r ' },
  { kind: 'prefix', value: 'dd ' }, { kind: 'prefix', value: 'mkfs' },
  { kind: 'prefix', value: 'fdisk' }, { kind: 'prefix', value: 'parted' },
  { kind: 'prefix', value: 'shred' }, { kind: 'prefix', value: 'truncate ' },
  { kind: 'prefix', value: 'chmod -r' }, { kind: 'prefix', value: 'chmod 777' },
  { kind: 'prefix', value: 'chown -r' },
  { kind: 'prefix', value: 'remove-item -recurse' }, { kind: 'prefix', value: 'del /s' },
  { kind: 'prefix', value: 'rd /s' }, { kind: 'prefix', value: 'diskpart' },
  { kind: 'prefix', value: 'format ' }, { kind: 'prefix', value: 'clear-disk' },
  // Git
  { kind: 'prefix', value: 'git push --force' }, { kind: 'prefix', value: 'git push -f' },
  { kind: 'prefix', value: 'git push --force-with-lease' },
  { kind: 'prefix', value: 'git reset --hard' }, { kind: 'prefix', value: 'git clean -f' },
  { kind: 'prefix', value: 'git branch -d' }, { kind: 'prefix', value: 'git tag -d' },
  { kind: 'prefix', value: 'git filter-branch' }, { kind: 'prefix', value: 'git filter-repo' },
  { kind: 'prefix', value: 'git remote remove' }, { kind: 'prefix', value: 'git remote set-url' },
  // System
  { kind: 'prefix', value: 'sudo ' }, { kind: 'prefix', value: 'su ' },
  { kind: 'prefix', value: 'doas ' }, { kind: 'prefix', value: 'shutdown' },
  { kind: 'prefix', value: 'reboot' }, { kind: 'prefix', value: 'halt' },
  { kind: 'prefix', value: 'systemctl stop' }, { kind: 'prefix', value: 'service restart' },
  { kind: 'prefix', value: 'service stop' },
  { kind: 'prefix', value: 'kill -9' }, { kind: 'prefix', value: 'taskkill /f' },
  { kind: 'prefix', value: 'stop-computer' }, { kind: 'prefix', value: 'set-executionpolicy' },
  { kind: 'prefix', value: 'crontab -r' }, { kind: 'prefix', value: 'userdel' },
  { kind: 'prefix', value: 'passwd' }, { kind: 'prefix', value: 'iptables -f' },
  { kind: 'regex', value: ':\\(\\)\\s*\\{' }, // fork bomb :(){ :|:& };:
  // Network: downloads piped into a shell, uploads of dumps/keys
  { kind: 'regex', value: '(curl|wget|irm|iwr|invoke-webrequest)[^|]*\\|\\s*(sudo\\s+)?(ba|z|fi|po)?sh\\b' },
  { kind: 'regex', value: '(ba)?sh\\s+-c\\s+.*(curl|wget)' },
  { kind: 'regex', value: 'iex\\b.*(downloadstring|curl|wget|irm|iwr)' },
  { kind: 'regex', value: '(curl|scp|rsync|sftp|aws s3 cp|azcopy)[^\n]*\\b(env|\\.ssh|id_rsa|credentials|secrets?)\\b' },
  // Packages and cloud
  { kind: 'prefix', value: 'npm publish' }, { kind: 'prefix', value: 'pip publish' },
  { kind: 'prefix', value: 'docker system prune' }, { kind: 'prefix', value: 'docker rm -f' },
  { kind: 'prefix', value: 'docker volume rm' }, { kind: 'prefix', value: 'kubectl delete' },
  { kind: 'prefix', value: 'terraform destroy' }, { kind: 'prefix', value: 'aws s3 rm' },
  { kind: 'prefix', value: 'gcloud projects delete' },
  { kind: 'prefix', value: 'gh repo delete' }, { kind: 'prefix', value: 'gh release delete' },
  { kind: 'regex', value: '\\b(drop|truncate)\\s+(table|database|schema)\\b' },
  { kind: 'prefix', value: 'flushall' },
]);

/** Reads the pattern file; any problem yields the built-in defaults. */
export function loadDestructivePatterns(path: string): readonly DestructivePattern[] {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { patterns?: DestructivePattern[] };
    if (Array.isArray(raw.patterns) && raw.patterns.every(p =>
      (p.kind === 'prefix' || p.kind === 'regex') && typeof p.value === 'string' && p.value)) {
      return raw.patterns;
    }
  } catch { /* missing or broken file: defaults */ }
  return DEFAULT_PATTERNS;
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Command segments: split chains, then also every $(...) and `...` body. */
function segments(command: string): string[] {
  const out: string[] = [];
  const subs: string[] = [];
  const stripped = command
    .replace(/\$\(([^()]*)\)|`([^`]*)`/g, (_, a: string, b: string) => { subs.push(a ?? b); return ' '; });
  out.push(...stripped.split(/&&|\|\||[;|\n]/));
  for (const sub of subs) out.push(...segments(sub));
  return out.map(normalize).filter(Boolean);
}

export function classifyCommand(command: string, patterns: readonly DestructivePattern[] = DEFAULT_PATTERNS): DestructiveHit | undefined {
  const compiled = patterns.map(p => ({
    rule: p.value,
    test: p.kind === 'prefix'
      ? (seg: string) => seg === normalize(p.value) || seg.startsWith(normalize(p.value) + ' ')
      : (() => { try { const re = new RegExp(p.value, 'i'); return (seg: string) => re.test(seg); } catch { return () => false; } })(),
  }));
  // Test the intact command too so regexes can see inside $(...)/`...` bodies.
  const candidates = [normalize(command), ...segments(command)];
  for (const segment of candidates) {
    for (const { rule, test } of compiled) if (test(segment)) return { rule, segment };
  }
  return undefined;
}
