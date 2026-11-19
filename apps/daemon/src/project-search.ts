import { FileError, searchPaths } from '@ormicode/files';
import type { Client } from './dispatch.ts';

export function projectSearchFiles(client: Client, id: string, body: Record<string, unknown>): void {
  try {
    return client.link.reply(id, searchPaths(String(body.project), String(body.query), Number(body.limit ?? 100)));
  } catch (error) {
    return client.link.replyError(id, error instanceof FileError ? error.code : 'file.failed',
      error instanceof Error ? error.message : String(error));
  }
}
