// terminal.* methods: forwards to the pty broker over one broker connection
// per client, so broker attach/replay semantics carry through unchanged.
import { ensureBroker, brokerSocketPath, type BrokerClient } from '@ormicode/pty-broker';
import { ormicodeDir } from './socket.ts';
import type { Client } from './dispatch.ts';
import { getSession, type Store } from '@ormicode/session-store';

export class TerminalHub {
  private readonly conns = new Map<Client, Promise<BrokerClient>>();
  readonly socketPath = brokerSocketPath(ormicodeDir());

  private conn(client: Client): Promise<BrokerClient> {
    let p = this.conns.get(client);
    if (!p) {
      p = ensureBroker(this.socketPath).then(b => {
        b.onEvent = e => {
          if (client.link.closed) return;
          const body = e.ev === 'output' ? { kind: 'terminal_output', offset: e.offset ?? 0, data: e.data ?? '' } : { kind: 'terminal_exit', code: e.code ?? null };
          client.link.send({ v: 1, type: 'term', terminal: e.terminal, body });
        };
        b.onClose = () => this.conns.delete(client);
        return b;
      });
      p.catch(() => this.conns.delete(client));
      this.conns.set(client, p);
    }
    return p;
  }

  drop(client: Client): void { void this.conns.get(client)?.then(b => b.close(), () => undefined); this.conns.delete(client); }

  /** Revoking a device kills its terminals immediately. */
  async killDevice(device: string): Promise<void> {
    const b = await ensureBroker(this.socketPath);
    await b.request('kill_device', { device }); b.close();
  }

  async open(db: Store, client: Client, id: string, body: Record<string, unknown>): Promise<void> {
    if (!body.cwd) {
      if (!body.session) return client.link.replyError(id, 'terminal.bad_request', 'provide cwd or session');
      const session = getSession(db, String(body.session));
      if (!session) return client.link.replyError(id, 'session.not_found', String(body.session));
      body = { ...body, cwd: session.cwd };
    }
    return this.method(client, id, 'terminal.open', body);
  }

  async method(client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
    const op = method.slice('terminal.'.length);
    const b = await this.conn(client);
    const { session: _session, ...args } = body;
    const res = await b.request(op, op === 'open' ? { ...args, device: client.device } : args);
    if (res.error) return client.link.replyError(id, res.error.code, res.error.message);
    const { id: _id, ok: _ok, ...rest } = res;
    return client.link.reply(id, rest);
  }
}
