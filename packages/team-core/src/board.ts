import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const marker = '\n## Entries\n';
function boardPath(dir: string, team: string): string {
  if (!/^t_[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(team)) throw new Error('invalid team id');
  return join(dir, 'teams', team, 'board.md');
}
export function readBoard(dir: string, team: string): string {
  const path = boardPath(dir, team);
  if (!existsSync(path)) {
    mkdirSync(join(dir, 'teams', team), { recursive: true });
    writeFileSync(path, `# Current state\n${marker}`);
  }
  return readFileSync(path, 'utf8');
}
export function writeBoard(dir: string, team: string, actor: string, parent: string, action: 'append' | 'setState', text: string, now = Date.now()): string {
  if (action === 'setState' && actor !== parent) throw new Error('only the team parent can rewrite current state');
  const raw = readBoard(dir, team);
  const split = raw.indexOf(marker);
  if (split < 0) throw new Error('board entries marker missing');
  const next = action === 'append'
    ? `${raw}\n### ${new Date(now).toISOString()} — ${actor}\n${text.split('\n').map(line => `> ${line}`).join('\n')}\n`
    : `# Current state\n${text.split('\n').map(line => `> ${line}`).join('\n')}\n${raw.slice(split)}`;
  const path = boardPath(dir, team);
  mkdirSync(join(dir, 'teams', team), { recursive: true });
  writeFileSync(path, next);
  return next;
}
