import { withDaemon } from './daemon.ts';

const USAGE = 'usage: ormi pricing status | refresh | get <model>';

export async function pricingCommand(verb: string | undefined, args: string[]): Promise<number> {
  if (verb !== 'status' && verb !== 'refresh' && !(verb === 'get' && args[0])) { console.error(USAGE); return 2; }
  return withDaemon(async link => {
    const res = await link.request(`pricing.${verb}`, verb === 'get' ? { model: args[0] } : {});
    if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
    const b = res.body as Record<string, unknown>;
    if (verb === 'get') {
      const p = b.price as { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null;
      console.log(p ? `${b.model}: $${p.input}/M in, $${p.output}/M out${p.cacheRead !== undefined ? `, $${p.cacheRead}/M cache read` : ''}${p.cacheWrite !== undefined ? `, $${p.cacheWrite}/M cache write` : ''} (${b.version})` : `${b.model}: no price (unknown model)`);
    } else console.log(`source: ${b.source}\nversion: ${b.version ?? '-'}\nmodels: ${b.models}\nfetched: ${b.fetchedAt ? new Date(Number(b.fetchedAt)).toISOString() : '-'}${b.error ? `\nlast error: ${b.error}` : ''}`);
    return 0;
  });
}

export async function costCommand(verb: string | undefined, args: string[]): Promise<number> {
  const index = args.indexOf('--since');
  const raw = index >= 0 ? args[index + 1] : undefined;
  const since = raw === undefined ? undefined : Number(raw);
  const invalidArgs = index < 0 ? args.length !== 0
    : args.length !== 2 || index !== 0 || !Number.isSafeInteger(since) || (since ?? -1) < 0;
  if (verb !== 'totals' || invalidArgs) {
    console.error('usage: ormi cost totals [--since <ms>]'); return 2;
  }
  return withDaemon(async link => {
    const res = await link.request('cost.totals', since === undefined ? {} : { since });
    if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
    console.log(JSON.stringify(res.body, null, 2));
    return 0;
  });
}
