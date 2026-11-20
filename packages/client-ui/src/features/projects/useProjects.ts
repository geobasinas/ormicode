import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export interface ProjectSummary {
  machine: string;
  path: string;
  name: string;
  git: boolean;
  addedAt: number;
}

let snapshot: ProjectSummary[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => snapshot;

export function useProjects(): { projects: ProjectSummary[]; refresh: () => Promise<void> } {
  const { transport } = usePlatform();
  const projects = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(async () => {
    try {
      const result = await transport.request('project.list', {});
      if (result.type !== 'res') return;
      snapshot = (result.body as { projects?: ProjectSummary[] }).projects ?? [];
      for (const listener of listeners) listener();
    } catch { /* keep the last successful registry snapshot */ }
  }, [transport]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  return { projects, refresh };
}
