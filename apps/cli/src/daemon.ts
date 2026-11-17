import * as daemonSocket from '@ormicode/daemon';

const socketPath = () => process.env.ORMICODE_SOCKET ?? daemonSocket.defaultSocketPath();

export async function withDaemon<T>(fn: (link: daemonSocket.Link) => Promise<T>): Promise<T> {
  const link = await daemonSocket.connect(socketPath()).catch(() => {
    console.error(`no daemon on ${socketPath()} — start one with \`ormi daemon\``);
    process.exit(2);
  });
  try { return await fn(link); } finally { link.close(); }
}

export async function daemonMain(): Promise<number> {
  const { startDaemon } = await import('@ormicode/daemon');
  const daemon = await startDaemon();
  console.log(`ormicode daemon listening on ${daemon.socketPath}`);
  await new Promise<void>(resolve => {
    process.on('SIGINT', resolve); process.on('SIGTERM', resolve);
  });
  await daemon.close();
  return 0;
}

export async function statusMain(): Promise<number> {
  return withDaemon(async link => {
    const res = await link.request('daemon.status', {});
    console.log(JSON.stringify(res.body));
    return 0;
  });
}
