import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function commit(cwd, message) {
  git(cwd, 'add', '-A');
  git(cwd, '-c', 'user.name=Git Test', '-c', 'user.email=git-test@example.com', 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ormi-git-core-'));
  const cwd = join(root, 'repo');
  mkdirSync(cwd);
  execFileSync('git', ['init', '-q', '-b', 'main', cwd]);
  git(cwd, 'config', 'user.name', 'Git Test');
  git(cwd, 'config', 'user.email', 'git-test@example.com');
  writeFileSync(join(cwd, 'tracked.txt'), 'base\n');
  const rootCommit = commit(cwd, 'root');
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  git(cwd, 'remote', 'add', 'origin', origin);
  git(cwd, 'push', '-u', 'origin', 'main');
  return { root, cwd, origin, rootCommit, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
