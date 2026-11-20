/** Git pane data: one hook per protocol call, refreshed on an interval and
 *  after actions; actions return the error message instead of throwing. */
import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { gitAction } from './git-action.ts';

export interface FileStat { path: string; oldPath?: string; status: string; binary?: boolean; added: number; removed: number }
export interface Commit { sha: string; subject: string; author: string; email: string; ts: number; parents: string[]; refs: string[]; pushed: boolean; session?: string }
export interface Branch { name: string; sha: string; subject: string; ts: number; upstream?: string | null; ahead?: number; behind?: number; current?: boolean; gone?: boolean }
export interface Stash { index: number; ref: string; message: string; branch: string; ts: number; files: number; added: number; removed: number }
export interface Pr {
  number: number; title: string; body: string; state: string; url: string; head: string; base: string; author: string; createdAt: number;
  checks: { name: string; state: string; durationMs: number | null }[]; reviewers: { login: string; state: string }[];
  additions: number; deletions: number; changedFiles: number;
}
export type GitResult = { state: 'done'; head: string } | { state: 'conflict'; conflict: { files: string[] } };

export function useGit<T>(session: string, method: string, body: Record<string, unknown> = {}, everyMs = 8000) {
  const { transport } = usePlatform();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(body);
  const reload = useCallback(async () => {
    const res = await transport.request(method, { session, ...JSON.parse(key) as object });
    if (res.type === 'err') { setError(String((res as { message?: string }).message ?? res.code)); return; }
    setError(null); setData(res.body as T);
  }, [transport, session, method, key]);
  useEffect(() => {
    void reload();
    if (!everyMs) return;
    const t = setInterval(() => void reload(), everyMs);
    return () => clearInterval(t);
  }, [reload, everyMs]);
  return { data, error, reload };
}

export function useGitAction(session: string) {
  const { transport } = usePlatform();
  return useCallback(async <T = Record<string, unknown>>(method: string, body: Record<string, unknown> = {}): Promise<{ body?: T; error?: string }> => {
    return gitAction<T>(transport, session, method, body);
  }, [transport, session]);
}
