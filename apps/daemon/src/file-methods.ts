import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FileError, fileBlame, fileHistory, listFiles, prepareWrite, readFile, searchContent, searchNames, writeFile } from '@ormicode/files';
import { getSession, sessionsInStates } from '@ormicode/session-store';
import type { Client, DispatchCtx } from './dispatch.ts';
import { ormicodeDir } from './socket.ts';

const IN_TURN = ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying'] as const;

function replyFileError(client: Client, id: string, error: unknown): void {
  if (error instanceof FileError) client.link.replyError(id, error.code, error.message);
  else client.link.replyError(id, 'file.failed', error instanceof Error ? error.message : String(error));
}

export async function fileMethod(ctx: DispatchCtx, client: Client, id: string, method: string, body: Record<string, unknown>): Promise<void> {
  const session = String(body.session);
  const row = getSession(ctx.db, session);
  if (!row) return client.link.replyError(id, 'session.not_found', session);
  const root = row.cwd;

  try {
    switch (method) {
      case 'file.list':
        return client.link.reply(id, listFiles(root, String(body.path ?? '')));
      case 'file.read':
        return client.link.reply(id, await readFile(root, String(body.path), typeof body.ref === 'string' ? body.ref : undefined, body.force === true));
      case 'file.write': {
        const busy = sessionsInStates(ctx.db, IN_TURN).some(candidate => candidate.cwd === row.cwd);
        if (busy) return client.link.replyError(id, 'file.busy', 'A session using this workspace is in a turn');
        const content = String(body.content);
        const target = prepareWrite(root, String(body.path), content, typeof body.baseMtime === 'number' ? body.baseMtime : undefined);
        const saved = writeFile(target, content);
        let checkpoint: string | null = null;
        if (process.env.ORMICODE_CHECKPOINTS !== '0' && existsSync(root) && !root.startsWith(join(ormicodeDir(), 'scratch'))) {
          const result = await ctx.checkpoints.snapshot(session, root, row.last_seq, 'manual edit');
          if (result?.checkpoint) {
            checkpoint = result.checkpoint.id;
            ctx.record(session, 'checkpoint', {
              id: checkpoint, seq: row.last_seq, tool: 'manual edit',
              ...(result.overCap ? { overCap: result.overCap } : {}),
            });
          }
        }
        ctx.record(session, 'file_edit', { path: saved.path, size: saved.size, checkpoint });
        return client.link.reply(id, { ...saved, checkpoint });
      }
      case 'file.search':
        return client.link.reply(id, body.mode === 'name'
          ? searchNames(root, String(body.query), Number(body.limit ?? 100))
          : await searchContent(root, String(body.query), body.regex === true, Number(body.limit ?? 200)));
      case 'file.blame':
        return client.link.reply(id, fileBlame(root, String(body.path)));
      case 'file.history':
        return client.link.reply(id, fileHistory(root, String(body.path), Number(body.limit ?? 50)));
      default:
        return client.link.replyError(id, 'protocol.unimplemented', method);
    }
  } catch (error) { replyFileError(client, id, error); }
}
