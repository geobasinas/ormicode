import { withDaemon } from './daemon.ts';

const USAGE = 'usage: ormi models [--agent x] [--transport y] [--refresh]';

export async function modelsCommand(args: string[]): Promise<number> {
  let agent: string | undefined;
  let transport: string | undefined;
  let refresh = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--refresh') refresh = true;
    else if (arg === '--agent' || arg === '--transport') {
      const value = args[++i];
      if (!value || value.startsWith('--')) { console.error(USAGE); return 2; }
      if (arg === '--agent') agent = value;
      else transport = value;
    } else { console.error(USAGE); return 2; }
  }
  return withDaemon(async link => {
    const res = await link.request('models.list', {
      ...(agent ? { agent } : {}), ...(transport ? { transport } : {}), ...(refresh ? { refresh: true } : {}),
    });
    if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
    const body = res.body as {
      models: { agent: string; transport: string; id: string; label: string; efforts: string[] }[];
      errors?: { agent: string; transport: string; message: string }[];
    };
    for (const model of body.models)
      console.log(`${model.agent}/${model.transport}  ${model.id}  ${model.label}  ${model.efforts.join(', ')}`);
    for (const error of body.errors ?? [])
      console.error(`${error.agent}/${error.transport}: ${error.message}`);
    if (!body.models.length && !body.errors?.length) console.log('no models listed');
    return body.errors?.length ? 1 : 0;
  });
}
