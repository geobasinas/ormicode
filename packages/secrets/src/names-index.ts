import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { NAME } from './inject.ts';

export interface SecretNamesIndex { machine: string[]; projects: Record<string, string[]> }

export function readNamesIndex(path: string): SecretNamesIndex {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SecretNamesIndex>;
    const names = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((n): n is string => typeof n === 'string' && NAME.test(n)))].sort() : [];
    const projects: Record<string, string[]> = {};
    if (parsed.projects && typeof parsed.projects === 'object') {
      for (const [project, items] of Object.entries(parsed.projects)) if (typeof project === 'string') {
        const list = names(items);
        if (list.length) projects[project] = list;
      }
    }
    return { machine: names(parsed.machine), projects };
  } catch { return { machine: [], projects: {} }; }
}

export function updateNamesIndex(path: string, name: string, project: string | undefined, add: boolean): void {
  if (!add && !existsSync(path)) return;
  const index = readNamesIndex(path);
  const list = project ? (index.projects[project] ?? []) : index.machine;
  const next = new Set(list);
  if (add) next.add(name); else next.delete(name);
  if (project) {
    if (next.size) index.projects[project] = [...next].sort(); else delete index.projects[project];
  } else index.machine = [...next].sort();
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temp, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
