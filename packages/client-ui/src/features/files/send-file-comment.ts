import { newId } from '@ormicode/protocol';
import type { ProtocolTransport } from '@ormicode/client-platform';
import type { SessionDetails } from '../session/useSession.ts';

type SessionDefaults = Pick<SessionDetails, 'project' | 'vendor' | 'transport' | 'model' | 'effort' | 'mode'>;

export async function sendFileComment(transport: Pick<ProtocolTransport, 'request'>, defaults: SessionDefaults, text: string, activeSession?: string): Promise<string> {
  if (!text.trim()) throw new Error('Enter a comment');
  let session = activeSession;
  if (!session) {
    const started = await transport.request('session.start', {
      machine: newId('m'), project: defaults.project, vendor: defaults.vendor, transport: defaults.transport,
      model: defaults.model ?? 'default', effort: defaults.effort ?? 'default', mode: defaults.mode ?? 'default',
      workspace: { kind: defaults.project === 'scratch' ? 'scratch' : 'current' },
    });
    if (started.type === 'err') throw new Error(started.message ?? started.code);
    session = (started.body as { session: string }).session;
  }
  let response = await transport.request('session.prompt', { session, text });
  if (response.type === 'err' && response.code === 'session.busy') response = await transport.request('session.queue.add', { session, text });
  if (response.type === 'err') throw new Error(response.message ?? response.code);
  return session;
}
