import type { ProtocolTransport } from '@ormicode/client-platform';

export async function gitAction<T>(transport: ProtocolTransport, session: string, method: string, body: Record<string, unknown>): Promise<{ body?: T; error?: string }> {
  try {
    const result = await transport.request(method, { session, ...body });
    return result.type === 'err' ? { error: result.message || result.code } : { body: result.body as T };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}
