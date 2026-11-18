import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Named markdown notes per session under <dir>/<session>/<n_id>.md; title in front matter. */
export interface Note { id: string; title: string; body: string; updatedAt: number }

const notePath = (dir: string, session: string, id: string) => join(dir, session, `${id}.md`);

const parse = (raw: string): { title: string; body: string } => {
  const m = /^---\ntitle: (.*)\n---\n?/.exec(raw);
  return m ? { title: m[1] ?? '', body: raw.slice(m[0].length) } : { title: 'Untitled', body: raw };
};

export function listNotes(dir: string, session: string): Note[] {
  const folder = join(dir, session);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(f => /^n_[0-7][0-9A-HJKMNP-TV-Z]{25}\.md$/.test(f) || f === `${session}.md`).map(f => {
    const raw = readFileSync(join(folder, f), 'utf8');
    const { title, body } = parse(raw);
    return { id: f.replace(/\.md$/, ''), title, body, updatedAt: Math.floor(statSync(join(folder, f)).mtimeMs) };
  });
}

export function setNote(dir: string, session: string, note: { id?: string; title: string; body: string }, makeId: () => string): string {
  mkdirSync(join(dir, session), { recursive: true });
  const id = note.id ?? makeId();
  writeFileSync(notePath(dir, session, id), `---\ntitle: ${note.title}\n---\n${note.body}`);
  return id;
}

export function deleteNote(dir: string, session: string, id: string): boolean {
  const p = notePath(dir, session, id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}
