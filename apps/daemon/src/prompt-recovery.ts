import { readFileSync, statSync } from 'node:fs';
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_MAX_BYTES, parseRequestBody, type PromptAttachment, type PromptContext } from '@ormicode/protocol';
import { getSession, type Store } from '@ormicode/session-store';
import { resolvePath } from '@ormicode/files';
import { PromptInvalidError } from './prompt-context.ts';

export function journalPrompt(db: Store, session: string): { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[] } | undefined {
  const row = db.prepare("SELECT payload FROM events WHERE session = ? AND kind = 'prompt' ORDER BY seq DESC LIMIT 1").get(session) as { payload: string } | undefined;
  if (!row) return undefined;
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    let totalBytes = 0;
    const attachments = Array.isArray(payload.attachments) ? payload.attachments.map(value => {
      const attachment = value as { name: string; mimeType: string; data?: string; path?: string };
      if (typeof attachment.data === 'string') return attachment;
      const cwd = getSession(db, session)?.cwd;
      if (!cwd || !attachment.path?.startsWith('.ormi/attachments/')) throw new Error('Attachment file is unavailable; reattach it');
      const root = resolvePath(cwd, '.ormi/attachments').absolute;
      const target = resolvePath(root, attachment.path.slice('.ormi/attachments/'.length)).absolute;
      const size = statSync(target).size; totalBytes += size;
      if (size > ATTACHMENT_MAX_BYTES || totalBytes > ATTACHMENTS_MAX_BYTES) throw new Error('Saved attachment exceeds the size limit');
      return { name: attachment.name, mimeType: attachment.mimeType, data: readFileSync(target).toString('base64') };
    }) : undefined;
    if (Array.isArray(payload.images) && payload.images.some(image => !image || typeof image.data !== 'string')) throw new Error('Original image bytes were not journaled; reattach images before retrying');
    const prompt = { session, text: payload.retryText ?? payload.text, context: payload.context, images: payload.images, attachments };
    const parsed = parseRequestBody('session.prompt', prompt);
    if (!parsed.success) throw new Error('Saved prompt is invalid; submit it again');
    return parsed.data as { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[] };
  } catch (error) {
    throw new PromptInvalidError(`Cannot restore prompt: ${error instanceof Error ? error.message : 'invalid journal data'}`);
  }
}
