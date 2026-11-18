import { readdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { relative, sep, join } from 'node:path';
import { Fzf, type FzfResultItem } from 'fzf';
import { rgPath } from '@vscode/ripgrep';
import { isGitRepo } from '@ormicode/git-core';
import { FileError } from './errors.ts';
import { resolvePath } from './paths.ts';

const NAME_CAP = 50_000;

function gitFiles(root: string): string[] {
  const output = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true,
  });
  return output.split('\0').filter(path => path && !path.toLowerCase().split('/').includes('.git'));
}

function walkFiles(root: string): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const pending = [root];
  let truncated = false;
  outer: while (pending.length) {
    const directory = pending.pop()!;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        if (files.length === NAME_CAP) { truncated = true; break outer; }
        files.push(relative(root, absolute).split(sep).join('/'));
      }
    }
  }
  return { files, truncated };
}

export function searchNames(root: string, query: string, limit = 100) {
  if (!query) throw new FileError('file.bad_query', 'Search query must not be empty');
  if (limit < 1 || limit > 500) throw new FileError('file.bad_query', 'Name search limit must be between 1 and 500');
  const safe = resolvePath(root, '');
  const tracked = isGitRepo(safe.root);
  const walked = tracked ? undefined : walkFiles(safe.root);
  let candidates: string[];
  try { candidates = tracked ? gitFiles(safe.root) : walked!.files; }
  catch (error) { throw new FileError('file.failed', error instanceof Error ? error.message : String(error)); }
  const matches = new Fzf(candidates).find(query) as FzfResultItem<string>[];
  return {
    files: matches.slice(0, limit).map(match => ({
      path: match.item, score: match.score, positions: [...match.positions].sort((a, b) => a - b),
    })),
    truncated: (walked?.truncated ?? false) || matches.length > limit,
  };
}

function byteIndexToUtf16(text: string, offset: number): number {
  return Buffer.from(text, 'utf8').subarray(0, offset).toString('utf8').length;
}

function rgPathText(path: { text?: string; bytes?: string }): string {
  const value = path.text !== undefined ? path.text : Buffer.from(path.bytes ?? '', 'base64').toString('utf8');
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function searchContent(root: string, query: string, regex = false, limit = 200): Promise<{
  matches: Array<{ path: string; line: number; text: string; ranges: Array<[number, number]> }>;
  truncated: boolean;
}> {
  if (!query) return Promise.reject(new FileError('file.bad_query', 'Search query must not be empty'));
  if (limit < 1 || limit > 1000) return Promise.reject(new FileError('file.bad_query', 'Content search limit must be between 1 and 1000'));
  const safe = resolvePath(root, '');
  const args = [
    '--json', '--line-number', '--smart-case', '--max-filesize', '2M', '--max-columns', '400', '--max-count', '50',
    ...(regex ? [] : ['--fixed-strings']), '--', query, '.',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { cwd: safe.root, windowsHide: true });
    const matches: Array<{ path: string; line: number; text: string; ranges: Array<[number, number]> }> = [];
    let remainder = '';
    let stderr = '';
    let truncated = false;
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const consume = (line: string) => {
      let event;
      try { event = JSON.parse(line) as { type?: string; data?: any }; } catch { return; }
      if (event.type !== 'match' || !event.data) return;
      const data = event.data as {
        path: { text?: string; bytes?: string };
        lines: { text: string };
        line_number: number;
        submatches: Array<{ start: number; end: number }>;
      };
      const text = data.lines.text.replace(/\r?\n$/, '');
      const ranges = data.submatches.map(range => [
        byteIndexToUtf16(text, range.start),
        byteIndexToUtf16(text, range.end),
      ] as [number, number]);
      matches.push({ path: rgPathText(data.path), line: data.line_number, text, ranges });
      if (matches.length >= limit) {
        truncated = true;
        child.kill();
      }
    };
    child.stdout.on('data', (chunk: string) => {
      remainder += chunk;
      let index = remainder.indexOf('\n');
      while (index >= 0 && matches.length < limit) {
        consume(remainder.slice(0, index));
        remainder = remainder.slice(index + 1);
        index = remainder.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4096); });
    child.on('error', error => {
      if (!settled) { settled = true; reject(new FileError('file.failed', error.message)); }
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (remainder && matches.length < limit) consume(remainder);
      if (code === 2) return reject(new FileError('file.bad_query', stderr.trim() || 'Invalid search expression'));
      if (code !== 0 && code !== 1 && !truncated) return reject(new FileError('file.failed', stderr.trim() || `ripgrep exited with ${code}`));
      resolve({ matches, truncated });
    });
  });
}
