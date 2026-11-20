/**
 * data.* methods behind Settings → Data and privacy. Local socket clients
 * only: a paired phone or browser can't pull the whole store or wipe the hub.
 * Export streams a tar in base64 chunks (frames cap at 256 KiB); wipe stops
 * the hub first so the store is closed before anything is deleted.
 */
import { closeSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Client, ClientLink, DispatchCtx } from './dispatch.ts';
import { RemoteLink } from './relay.ts';
import { ormicodeDir } from './socket.ts';
import { exportFileName, wipeHome, writeExportInHome, WIPE_CONFIRM, type WipeResult } from './home-data.ts';

export const EXPORT_CHUNK = 96 * 1024;
const EXPORT_TTL_MS = 10 * 60_000;

/** Temp export files waiting to be downloaded; removed when read to the end, after 10 min, or on shutdown. */
export class DataExports {
  private readonly files = new Map<string, { path: string; size: number; timer: NodeJS.Timeout }>();
  add(path: string): { handle: string; size: number } {
    const handle = randomBytes(12).toString('hex');
    const size = statSync(path).size;
    const timer = setTimeout(() => this.drop(handle), EXPORT_TTL_MS);
    timer.unref();
    this.files.set(handle, { path, size, timer });
    return { handle, size };
  }
  read(handle: string, offset: number): { data: string; done: boolean } | undefined {
    const file = this.files.get(handle);
    if (!file || offset > file.size) return undefined;
    const length = Math.min(EXPORT_CHUNK, file.size - offset);
    const buffer = Buffer.alloc(length);
    const fd = openSync(file.path, 'r');
    try { readSync(fd, buffer, 0, length, offset); } finally { closeSync(fd); }
    const done = offset + length >= file.size;
    if (done) this.drop(handle);
    return { data: buffer.toString('base64'), done };
  }
  drop(handle: string): void {
    const file = this.files.get(handle);
    if (!file) return;
    clearTimeout(file.timer); this.files.delete(handle);
    rmSync(file.path, { force: true });
  }
  clear(): void { for (const handle of [...this.files.keys()]) this.drop(handle); }
}

/**
 * The supervisor's shutdown, shared by close() and data.wipe. Idempotent. data.wipe passes `keep`
 * so its own link outlives the shutdown: everything else stops, the store closes, then `after` runs.
 */
export type StopHub = (keep: { link: ClientLink; after(): Promise<void> }) => Promise<void>;

/** Resolves once the hub has fully stopped, however it was stopped; the daemon process exits on it. */
export function stopSignal(): { stopped: Promise<void>; markStopped(): void } {
  let markStopped!: () => void;
  const stopped = new Promise<void>(resolve => { markStopped = resolve; });
  return { stopped, markStopped };
}

export async function dataMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  if (client.link instanceof RemoteLink)
    return client.link.replyError(id, 'data.local_only', 'Export and delete only work on the hub’s own computer.');
  const home = ormicodeDir();
  if (method === 'data.export') {
    const { path, files } = writeExportInHome(home, ctx.db);
    const { handle, size } = ctx.dataExports.add(path);
    return client.link.reply(id, { handle, size, name: exportFileName(), files });
  }
  if (method === 'data.exportChunk') {
    const chunk = ctx.dataExports.read(String(body.handle), Number(body.offset));
    if (!chunk) return client.link.replyError(id, 'data.export_expired', 'This export is no longer available. Start it again.');
    return client.link.reply(id, chunk);
  }
  if (method === 'data.wipe') {
    if (body.confirm !== WIPE_CONFIRM) return client.link.replyError(id, 'data.confirm_mismatch', `Type "${WIPE_CONFIRM}" to confirm.`);
    if (ctx.storePath !== join(home, 'store.db'))
      return client.link.replyError(id, 'data.store_elsewhere', `The store is at ${ctx.storePath}, outside ${home}. Stop the hub and remove it yourself.`);
    const link = client.link;
    return ctx.stopHub({
      link,
      async after() {
        let result: WipeResult;
        try { result = wipeHome(home, WIPE_CONFIRM); }
        catch (error) { link.replyError(id, 'data.wipe_failed', `${(error as Error).message}. The hub has stopped.`); return; }
        link.reply(id, { wiped: true, removed: result.removed, kept: result.kept, ...(result.leftover ? { leftover: result.leftover } : {}) });
      },
    });
  }
  return client.link.replyError(id, 'protocol.unimplemented', method);
}
