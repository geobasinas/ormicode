import type { Frame, PromptAttachment, PromptContext } from '@ormicode/protocol';
import { getSession, getTeam, listQueuedPrompts, markTeamMessagesRead, removeQueuedPrompt, settingValue, setQueuedPromptError, teamChildren, unreadTeamMessages } from '@ormicode/session-store';
import { teamLimits } from '@ormicode/team-core';
import type { Store } from '@ormicode/session-store';
import type { TerminalHub } from './terminal-methods.ts';
import { expandPrompt, PromptInvalidError } from './prompt-context.ts';
import type { PreviewConsoleEntry } from './preview-inspector.ts';

type Prompt = { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[] };

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
  const sending = new Set<string>();

  const sendPrompt = async (
    session: string,
    text: string,
    images?: unknown[],
    opts?: { journal?: boolean; context?: PromptContext[]; attachments?: PromptAttachment[] },
  ): Promise<boolean> => {
    const row = getSession(options.db, session);
    if (!row) return false;
    if (row.team && getTeam(options.db, row.team)?.parent !== session) {
      if (row.archived || getTeam(options.db, row.team)?.closed_at != null) throw new Error('team.closed: child is closed');
      const busy = teamChildren(options.db, row.team).filter(s => s.id !== session && !s.archived
        && (sending.has(s.id) || ['starting', 'running', 'retrying', 'awaiting_approval', 'awaiting_input'].includes(s.state))).length;
      if (busy >= teamLimits(key => settingValue(options.db, key)).concurrent) throw new Error('team.limit: concurrent child limit reached');
    }
    if (sending.has(session)) return false;
    sending.add(session);
    try {
      await options.ensureWorker(session);
      const messages = unreadTeamMessages(options.db, session);
      const deliveredText = messages.length
        ? `Team inbox:\n${messages.map(m => `[${m.id}] From ${m.from_session}: ${m.body}`).join('\n')}\n\n${text}` : text;
      let prepared: ReturnType<typeof expandPrompt>;
      try {
        prepared = expandPrompt({
          cwd: row.cwd,
          session,
          baseCommit: row.base_commit,
          notesDir: options.notesDir,
          terminalOutput: (id, terminal) => options.terminals.recentOutput(id, terminal),
          previewEntries: options.previewEntries,
        }, { text: deliveredText, context: opts?.context, attachments: opts?.attachments });
      } catch (error) {
        throw new PromptInvalidError(error instanceof Error ? error.message : String(error));
      }
      const wireImages = (images as { data: string; mimeType: string }[] | undefined)?.map(({ data, mimeType }) => ({ data, mimeType }));
      const res = await options.toWorker(session, 'worker.prompt', {
        text: prepared.text,
        ...(wireImages ? { images: wireImages } : {}),
      });
      if (!res || res.type === 'err') return false;
      markTeamMessagesRead(options.db, messages.map(m => m.id));
      options.lastPrompt.set(session, {
        text,
        ...(images ? { images } : {}),
        ...(opts?.context ? { context: opts.context } : {}),
        ...(opts?.attachments ? { attachments: opts.attachments } : {}),
      });
      if (opts?.journal !== false) options.record(session, 'prompt', {
        text: deliveredText,
        ...(opts?.context?.length ? { context: opts.context } : {}),
        ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}),
        ...(images?.length ? {
          images: (images as { name?: string; mimeType: string; size?: number }[])
            .map(image => ({ name: image.name ?? 'Image', mimeType: image.mimeType, size: image.size ?? 0 })),
        } : {}),
      });
      return true;
    } finally { sending.delete(session); }
  };

  const drainQueue = async (session: string, afterTurnEnd = false): Promise<boolean> => {
    if (afterTurnEnd) {
      const team = getSession(options.db, session)?.team;
      if (team) for (const child of teamChildren(options.db, team)) {
        if (child.id !== session && !child.archived) void drainQueue(child.id).catch(() => undefined);
      }
    }
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
          if (!await sendPrompt(session, prompt.text, prompt.images, { context: prompt.context, attachments: prompt.attachments })) return false;
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
        if (!await sendPrompt(session, item.text, item.images, { context: item.context, attachments: item.attachments })) return false;
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

  return { sendPrompt, drainQueue };
}

function queueEventItems(db: Store, session: string) {
  return listQueuedPrompts(db, session).map(item => ({
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    ...(item.images?.length ? { images: item.images.length } : {}),
  }));
}
