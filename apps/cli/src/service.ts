import { withDaemon } from './daemon.ts';

const fail = (response: { type: string; code?: string; message?: string }): 0 | 1 =>
  response.type === 'err' ? (console.error(`${response.code}: ${response.message}`), 1) : 0;

export async function serviceCommand(verb: string | undefined, args: string[]): Promise<number> {
  if (!verb || !['list', 'start', 'stop', 'restart', 'logs'].includes(verb)) {
    console.error('usage: ormi service list|start|stop|restart|logs <session> [service]');
    return 2;
  }
  const [session, service, afterText] = args;
  if (!session || (verb !== 'list' && !service)) {
    console.error(`usage: ormi service ${verb} <session>${verb === 'list' ? '' : ' <service>'}${verb === 'logs' ? ' [after]' : ''}`);
    return 2;
  }
  const after = afterText === undefined ? undefined : Number(afterText);
  if (after !== undefined && (!Number.isInteger(after) || after < 0)) {
    console.error('service log cursor must be a non-negative integer');
    return 2;
  }
  return withDaemon(async link => {
    const method = `service.${verb}`;
    const body = verb === 'list' ? { session }
      : verb === 'logs' ? { session, service, ...(after === undefined ? {} : { after }) }
        : { session, service };
    const response = await link.request(method, body);
    if (fail(response)) return 1;
    console.log(JSON.stringify(response.body, null, 2));
    return 0;
  });
}

export async function previewCommand(verb: string | undefined, args: string[]): Promise<number> {
  if (verb === 'console') {
    const [session, ...options] = args;
    let after: number | undefined;
    if (!session || options.length !== 0 && (options.length !== 2 || options[0] !== '--after'
      || !Number.isInteger(Number(options[1])) || Number(options[1]) < 0)) {
      console.error('usage: ormi preview console <session> [--after n]');
      return 2;
    }
    if (options.length) after = Number(options[1]);
    return withDaemon(async link => {
      const response = await link.request('preview.console', { session, ...(after === undefined ? {} : { after }) });
      if (fail(response)) return 1;
      console.log(JSON.stringify(response.body, null, 2));
      return 0;
    });
  }
  if (verb !== 'url' || args.length < 2 || args.length > 3) {
    console.error('usage: ormi preview url <session> <port> [path] | preview console <session> [--after n]');
    return 2;
  }
  const [session, portText, path] = args;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('preview port must be an integer from 1 to 65535');
    return 2;
  }
  return withDaemon(async link => {
    const response = await link.request('preview.url', { session, port, ...(path ? { path } : {}) });
    if (fail(response)) return 1;
    console.log((response.body as { url: string }).url);
    return 0;
  });
}
