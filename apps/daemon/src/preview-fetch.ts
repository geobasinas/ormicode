import { randomBytes } from 'node:crypto';

export const PREVIEW_FETCH_CHUNK_BYTES = 512 * 1024;
const MAX_HANDLES_PER_CLIENT = 32;
const HANDLE_IDLE_MS = 60_000;

export class PreviewFetchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

interface FetchResult { status: number; headers: Record<string, string | string[]>; body: Buffer }
interface Handle {
  client: string;
  body: Buffer;
  offset: number;
  timer: ReturnType<typeof setTimeout>;
}

export class PreviewFetchPages {
  private readonly handles = new Map<string, Handle>();
  private readonly idleMs: number;
  constructor(idleMs = HANDLE_IDLE_MS) { this.idleMs = idleMs; }

  first(client: string, response: FetchResult) {
    const page = response.body.subarray(0, PREVIEW_FETCH_CHUNK_BYTES);
    const remaining = response.body.length - page.length;
    let more: string | undefined;
    if (remaining > 0) {
      const open = [...this.handles.values()].filter(handle => handle.client === client).length;
      if (open >= MAX_HANDLES_PER_CLIENT)
        throw new PreviewFetchError('preview.unavailable', 'This client already has 32 open preview response handles.');
      more = randomBytes(24).toString('base64url');
      const handle: Handle = { client, body: response.body, offset: page.length, timer: setTimeout(() => this.remove(more!), this.idleMs) };
      handle.timer.unref();
      this.handles.set(more, handle);
    }
    return {
      status: response.status, headers: response.headers, size: response.body.length,
      body: page.toString('base64'), ...(more ? { more } : {}),
    };
  }

  next(client: string, id: string) {
    const handle = this.handles.get(id);
    if (!handle || handle.client !== client)
      throw new PreviewFetchError('preview.unavailable', 'Preview response handle is unknown or expired.');
    const page = handle.body.subarray(handle.offset, handle.offset + PREVIEW_FETCH_CHUNK_BYTES);
    handle.offset += page.length;
    clearTimeout(handle.timer);
    if (handle.offset >= handle.body.length) this.handles.delete(id);
    else {
      handle.timer = setTimeout(() => this.remove(id), this.idleMs);
      handle.timer.unref();
    }
    return { body: page.toString('base64'), ...(this.handles.has(id) ? { more: id } : {}) };
  }

  close(): void {
    for (const handle of this.handles.values()) clearTimeout(handle.timer);
    this.handles.clear();
  }

  private remove(id: string): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    clearTimeout(handle.timer);
    this.handles.delete(id);
  }
}
