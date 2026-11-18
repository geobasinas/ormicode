import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export interface ListedModel {
  agent: string;
  transport: string;
  id: string;
  label: string;
  efforts: string[];
  available: boolean;
  reason?: string;
  cachedAt: number;
}

interface ModelsState {
  models: ListedModel[];
  loading: boolean;
  errors: string[];
}

type ClientTransport = ReturnType<typeof usePlatform>['transport'];

const cache = new Map<string, ModelsState>();
const inflight = new Map<string, Promise<ModelsState>>();
const listeners = new Map<string, Set<(state: ModelsState) => void>>();

function keyFor(agent: string, transport: string): string { return `${agent}/${transport}`; }

function publish(key: string, state: ModelsState): void {
  cache.set(key, state);
  for (const listener of listeners.get(key) ?? []) listener(state);
}

function load(transport: ClientTransport, agent: string, via: string, refresh = false): Promise<ModelsState> {
  const key = keyFor(agent, via);
  const existing = inflight.get(key);
  if (existing) return existing;
  const cached = cache.get(key);
  publish(key, { models: cached?.models ?? [], loading: true, errors: cached?.errors ?? [] });
  const pending = (async () => {
    try {
      const result = await transport.request('models.list', { agent, transport: via, ...(refresh ? { refresh: true } : {}) });
      if (result.type === 'err') {
        const state = { models: [], loading: false, errors: [`${result.code}: ${result.message}`] };
        publish(key, state);
        return state;
      }
      const body = result.body as { models: ListedModel[]; errors?: { agent: string; transport: string; message: string }[] };
      const state = { models: body.models ?? [], loading: false, errors: (body.errors ?? []).map(error => `${error.agent}/${error.transport}: ${error.message}`) };
      publish(key, state);
      return state;
    } catch (error) {
      const state = { models: [], loading: false, errors: [error instanceof Error ? error.message : String(error)] };
      publish(key, state);
      return state;
    }
  })();
  inflight.set(key, pending);
  void pending.finally(() => { if (inflight.get(key) === pending) inflight.delete(key); });
  return pending;
}

export function useModels(agent: string | undefined, via: string | undefined): ModelsState & { refresh: () => Promise<ModelsState> } {
  const { transport } = usePlatform();
  const key = agent && via ? keyFor(agent, via) : '';
  const [current, setCurrent] = useState<{ key: string; state: ModelsState }>(() => ({
    key, state: cache.get(key) ?? { models: [], loading: Boolean(key), errors: [] },
  }));

  useEffect(() => {
    if (!agent || !via) { setCurrent({ key, state: { models: [], loading: false, errors: [] } }); return; }
    let alive = true;
    const update = (next: ModelsState) => { if (alive) setCurrent({ key, state: next }); };
    let subscribers = listeners.get(key);
    if (!subscribers) { subscribers = new Set(); listeners.set(key, subscribers); }
    subscribers.add(update);
    const cached = cache.get(key);
    if (cached) setCurrent({ key, state: cached });
    else void load(transport, agent, via);
    return () => {
      alive = false;
      subscribers?.delete(update);
      if (!subscribers?.size) listeners.delete(key);
    };
  }, [transport, agent, via, key]);

  const refresh = useCallback(
    () => agent && via ? load(transport, agent, via, true) : Promise.resolve({ models: [], loading: false, errors: [] }),
    [transport, agent, via],
  );
  const state = current.key === key ? current.state : cache.get(key) ?? { models: [], loading: Boolean(key), errors: [] };
  return { ...state, refresh };
}
