/** Account settings from the hub (`settings.get` / `settings.set`). */
import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
import { feedback } from '../../lib/feedback.ts';
import { failure } from './parts.tsx';

export interface HubSetting { key: string; value: number | string; default: number | string; set: boolean; min?: number; max?: number; choices?: string[] }
interface HubSettings { profile: 'laptop' | 'vps'; settings: HubSetting[] }

export function useHubSettings() {
  const { transport } = usePlatform();
  const [data, setData] = useState<HubSettings>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    transport.request('settings.get', {})
      .then(r => { if (!alive) return; if (r.type === 'res') setData(r.body as unknown as HubSettings); else setError(failure(r)); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [transport]);
  /** `null` clears the stored value back to the default. Resolves true when saved. */
  const update = useCallback(async (key: string, value: number | string | null): Promise<boolean> => {
    try {
      const r = await transport.request('settings.set', { key, value });
      if (r.type !== 'res') { feedback.error(failure(r)); return false; }
      const next = r.body as unknown as HubSetting;
      setData(d => d && { ...d, settings: d.settings.map(s => s.key === key ? next : s) });
      return true;
    } catch (e) { feedback.error(e instanceof Error ? e.message : String(e)); return false; }
  }, [transport]);
  const get = (key: string) => data?.settings.find(s => s.key === key);
  return { profile: data?.profile, get, update, error, loading: !data && !error };
}
