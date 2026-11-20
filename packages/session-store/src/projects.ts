import type { Store } from './db.ts';

export interface ProjectRow {
  machine: string;
  path: string;
  name: string;
  addedAt: number;
}

type StoredProject = Omit<ProjectRow, 'addedAt'> & { added_at: number };
const row = (item: StoredProject): ProjectRow => ({
  machine: item.machine, path: item.path, name: item.name, addedAt: item.added_at,
});

export function listProjects(db: Store): ProjectRow[] {
  return (db.prepare('SELECT machine, path, name, added_at FROM projects ORDER BY added_at DESC')
    .all() as StoredProject[]).map(row);
}

export function addProject(db: Store, project: ProjectRow): ProjectRow {
  db.prepare(`INSERT OR IGNORE INTO projects(machine, path, name, added_at)
    VALUES (?, ?, ?, ?)`).run(project.machine, project.path, project.name, project.addedAt);
  return row(db.prepare('SELECT machine, path, name, added_at FROM projects WHERE machine = ? AND path = ?')
    .get(project.machine, project.path) as StoredProject);
}

export function removeProject(db: Store, machine: string, path: string): boolean {
  return db.prepare('DELETE FROM projects WHERE machine = ? AND path = ?').run(machine, path).changes > 0;
}
