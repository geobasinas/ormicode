import { newId, type Frame, type PromptAttachment, type PromptContext } from '@ormicode/protocol';
import { addQueuedPrompt, getSession, listQueuedPrompts, moveQueuedPrompt, removeQueuedPrompt, setQueuedPromptError } from '@ormicode/session-store';
import type { Store } from '@ormicode/session-store';
import type { TerminalHub } from './terminal-methods.ts';
import { expandPrompt, PromptInvalidError } from './prompt-context.ts';
import type { PreviewConsoleEntry } from './preview-inspector.ts';

type Prompt = { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' };

interface PromptDeliveryOptions {
  db: Store;
  notesDir: string;
  paused: Set<string>;
  heldPrompts: Map<string, Prompt[]>;
  lastPrompt: Map<string, Prompt>;
  ensureWorker(session: string): Promise<void>;
  toWorker(session: string, method: string, body: Record<string, unknown>): Promise<Frame | undefined>;
  terminals: TerminalHub;
  previewEntries(session: string, ids: string[]): PreviewConsoleEntry[];
  record(session: string, kind: string, payload: Record<string, unknown>): void;
}

export function createPromptDelivery(options: PromptDeliveryOptions) {
  const queueSending = new Set<string>();
  const queueRequested = new Set<string>();

  const sendPrompt = async (
    session: string,
    text: string,
    images?: unknown[],
    opts?: { journal?: boolean; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' },
  ): Promise<boolean> => {
    await options.ensureWorker(session);
    const row = getSession(options.db, session);
    if (!row) return false;
    let prepared: ReturnType<typeof expandPrompt>;
    try {
      prepared = expandPrompt({
        cwd: row.cwd,
        session,
        baseCommit: row.base_commit,
        notesDir: options.notesDir,
        terminalOutput: (id, terminal) => options.terminals.recentOutput(id, terminal),
        previewEntries: options.previewEntries,
      }, { text, context: opts?.context, attachments: opts?.attachments });
    } catch (error) {
      throw new PromptInvalidError(error instanceof Error ? error.message : String(error));
    }
    const wireImages = (images as { data: string; mimeType: string }[] | undefined)?.map(({ data, mimeType }) => ({ data, mimeType }));
    const res = await options.toWorker(session, 'worker.prompt', {
      text: prepared.text,
      ...(wireImages ? { images: wireImages } : {}),
    });
    if (!res || res.type === 'err') return false;
    options.lastPrompt.set(session, {
      text,
      ...(images ? { images } : {}),
      ...(opts?.context ? { context: opts.context } : {}),
      ...(opts?.attachments ? { attachments: opts.attachments } : {}),
      ...(opts?.actor ? { actor: opts.actor } : {}),
    });
    if (opts?.journal !== false) options.record(session, 'prompt', {
      text,
      ...(opts?.context?.length ? { context: opts.context } : {}),
      ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}),
      ...(opts?.actor ? { actor: opts.actor } : {}),
      ...(images?.length ? {
        images: (images as { name?: string; mimeType: string; size?: number }[])
          .map(image => ({ name: image.name ?? 'Image', mimeType: image.mimeType, size: image.size ?? 0 })),
      } : {}),
    });
    return true;
  };

  const drainQueue = async (session: string, afterTurnEnd = false): Promise<boolean> => {
    if (options.paused.has(session)) return true;
    const current = getSession(options.db, session);
    if (!current || !['idle', 'done'].includes(current.state)) return true;
    if (queueSending.has(session)) {
      if (afterTurnEnd) queueRequested.add(session);
      return true;
    }
    queueSending.add(session);
    let sent = false;
    try {
      const held = options.heldPrompts.get(session);
      const prompt = held?.[0];
      if (prompt) {
        try {
          if (!await sendPrompt(session, prompt.text, prompt.images, { context: prompt.context, attachments: prompt.attachments, actor: prompt.actor })) return false;
        } catch { return false; }
        held!.shift();
        if (!held!.length) options.heldPrompts.delete(session);
        sent = true;
        return true;
      }
      const item = listQueuedPrompts(options.db, session)[0];
      if (!item) return true;
      if (item.error) { queueRequested.delete(session); return false; }
      try {
        if (!await sendPrompt(session, item.text, item.images, { context: item.context, attachments: item.attachments, actor: item.actor })) return false;
      } catch (error) {
        if (error instanceof PromptInvalidError) {
          setQueuedPromptError(options.db, session, item.id, error.message);
          options.record(session, 'queue_changed', { items: queueEventItems(options.db, session) });
          queueRequested.delete(session);
          return false;
        }
        return false;
      }
      removeQueuedPrompt(options.db, session, item.id);
      options.record(session, 'queue_changed', { items: queueEventItems(options.db, session) });
      sent = true;
      return true;
    } finally {
      queueSending.delete(session);
      const latest = getSession(options.db, session);
      if (sent && queueRequested.delete(session) && !options.paused.has(session)
        && latest && ['idle', 'done'].includes(latest.state)) void drainQueue(session);
    }
  };

  const enqueueAutoPrompt = (session: string, text: string, context: PromptContext[]): void => {
    const item = { id: newId('q'), text, createdAt: Date.now(), context, actor: 'auto' as const };
    addQueuedPrompt(options.db, session, item);
    moveQueuedPrompt(options.db, session, item.id, 0);
    options.record(session, 'queue_changed', { items: queueEventItems(options.db, session) });
  };

  return { sendPrompt, drainQueue, enqueueAutoPrompt };
}

function queueEventItems(db: Store, session: string) {
  return listQueuedPrompts(db, session).map(item => ({
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    ...(item.images?.length ? { images: item.images.length } : {}),
    ...(item.actor ? { actor: item.actor } : {}),
  }));
}
