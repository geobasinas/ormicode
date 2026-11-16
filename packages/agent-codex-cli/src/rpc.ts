import * as z from 'zod/mini';

const id = z.union([z.string(), z.number().check(z.int())]);
const base = { jsonrpc: z.optional(z.literal('2.0')) };
const request = z.looseObject({ ...base, id, method: z.string().check(z.minLength(1)), params: z.optional(z.json()) }).check(z.refine((frame) => !Object.hasOwn(frame, 'result') && !Object.hasOwn(frame, 'error')));
const notification = z.looseObject({ ...base, method: z.string().check(z.minLength(1)), params: z.optional(z.json()) }).check(z.refine((frame) => !Object.hasOwn(frame, 'id') && !Object.hasOwn(frame, 'result') && !Object.hasOwn(frame, 'error')));
const response = z.looseObject({ ...base, id, result: z.json() }).check(z.refine((frame) => !Object.hasOwn(frame, 'error') && !Object.hasOwn(frame, 'method')));
const failure = z.looseObject({ ...base, id: z.nullable(id), error: z.looseObject({ code: z.number().check(z.int()), message: z.string() }) }).check(z.refine((frame) => !Object.hasOwn(frame, 'result') && !Object.hasOwn(frame, 'method')));
export const rpcFrameSchema = z.union([request, notification, response, failure]);
export type RpcFrame = z.infer<typeof rpcFrameSchema>;
export const MAX_RPC_LINE_BYTES = 1024 * 1024;

/** Decode app-server JSONL incrementally without accepting oversized or truncated lines. */
export class RpcLineDecoder {
  private buffer = new Uint8Array(0);
  push(chunk: Uint8Array): RpcFrame[] {
    const frames: RpcFrame[] = [];
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10) continue;
      this.append(chunk.subarray(start, i));
      if (this.buffer.length) frames.push(this.read());
      this.buffer = new Uint8Array(0); start = i + 1;
    }
    this.append(chunk.subarray(start));
    return frames;
  }
  finish(): void { if (this.buffer.length) throw new Error('Truncated app-server JSONL frame'); }
  private append(chunk: Uint8Array): void {
    if (this.buffer.length + chunk.length > MAX_RPC_LINE_BYTES) throw new Error('App-server frame exceeds size limit');
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer); combined.set(chunk, this.buffer.length); this.buffer = combined;
  }
  private read(): RpcFrame {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(this.buffer);
    return z.parse(rpcFrameSchema, JSON.parse(text));
  }
}
