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
