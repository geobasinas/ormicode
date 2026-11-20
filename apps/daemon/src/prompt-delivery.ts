import { newId, type Frame, type PromptAttachment, type PromptContext } from '@ormicode/protocol';
import { addQueuedPrompt, getSession, getTeam, markTeamMessagesRead, settingValue, teamChildren, unreadTeamMessages, listQueuedPrompts, moveQueuedPrompt, removeQueuedPrompt, setQueuedPromptError } from '@ormicode/session-store';
import { teamLimits } from '@ormicode/team-core';
import type { Store } from '@ormicode/session-store';
import type { TerminalHub } from './terminal-methods.ts';
import { expandPrompt, PromptInvalidError } from './prompt-context.ts';
import type { PreviewConsoleEntry } from './preview-inspector.ts';
import { handoffTargetError } from './handoff-transition.ts';

type Prompt = { text: string; images?: unknown[]; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' };

interface PromptDeliveryOptions {
  db: Store;
  notesDir: string;
  paused: Set<string>;
  heldPrompts: Map<string, Prompt[]>;
  lastPrompt: Map<string, Prompt>;
  closed?(): boolean;
  ensureWorker(session: string): Promise<void>;
  restartWorker?(session: string): Promise<void>;
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
    opts?: { journal?: boolean; context?: PromptContext[]; attachments?: PromptAttachment[]; actor?: 'auto' },
  ): Promise<boolean> => {
    const row = getSession(options.db, session);
    if (!row || handoffTargetError(options.db, session)) return false;
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
      if (options.closed?.() || handoffTargetError(options.db, session)) return false;
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
      const previousState = getSession(options.db, session)!.state;
      options.record(session, 'state', { state: 'starting', reason: 'prompt_dispatch' });
      let res: Frame | undefined;
      try {
        res = await options.toWorker(session, 'worker.prompt', {
          text: prepared.text,
          ...(wireImages ? { images: wireImages } : {}),
        });
        if (res?.type === 'err' && res.code === 'agent.failed' && options.restartWorker
          && getSession(options.db, session)?.state === 'starting'
          && ['idle', 'done', 'interrupted'].includes(previousState)) {
          await options.restartWorker(session);
          options.record(session, 'state', { state: 'starting', reason: 'prompt_recovery' });
          res = await options.toWorker(session, 'worker.prompt', {
            text: prepared.text,
            ...(wireImages ? { images: wireImages } : {}),
          });
        }
      } finally {
        if ((!res || res.type === 'err') && getSession(options.db, session)?.state === 'starting')
          options.record(session, 'state', { state: previousState, reason: 'prompt_rejected' });
      }
      if (!res || res.type === 'err') return false;
      markTeamMessagesRead(options.db, messages.map(m => m.id));
      options.lastPrompt.set(session, {
        text,
        ...(images ? { images } : {}),
        ...(opts?.context ? { context: opts.context } : {}),
        ...(opts?.attachments ? { attachments: opts.attachments } : {}),
        ...(opts?.actor ? { actor: opts.actor } : {}),
      });
      if (opts?.journal !== false) options.record(session, 'prompt', {
        text: deliveredText,
        ...(opts?.actor ? { actor: opts.actor } : {}),
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

  const drainQueue = async (session: string, afterTurnEnd = false, siblingsOnly = false): Promise<boolean> => {
    if (options.closed?.()) return false;
    if (afterTurnEnd) {
      const team = getSession(options.db, session)?.team;
      if (team) for (const child of teamChildren(options.db, team)) {
        if (child.id !== session && !child.archived) void drainQueue(child.id).catch(() => undefined);
      }
    }
    if (siblingsOnly) return true;
    if (handoffTargetError(options.db, session)) return false;
    if (options.paused.has(session)) return true;
    const current = getSession(options.db, session);
    if (!current || current.archived
      || !['idle', 'done', 'interrupted'].includes(current.state)) return true;
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
      const latest = options.closed?.() ? undefined : getSession(options.db, session);
      if (sent && queueRequested.delete(session) && !options.paused.has(session)
        && latest && ['idle', 'done'].includes(latest.state)) void drainQueue(session);
    }
  };

  const enqueueAutoPrompt = (session: string, text: string, context: PromptContext[]): void => {
    if (handoffTargetError(options.db, session)) return;
    const item = { id: newId('q'), text, createdAt: Date.now(), context, actor: 'auto' as const };
    addQueuedPrompt(options.db, session, item);
    moveQueuedPrompt(options.db, session, item.id, 0);
    options.record(session, 'queue_changed', { items: queueEventItems(options.db, session) });
  };

  return { sendPrompt, drainQueue, enqueueAutoPrompt };
}

export function queueEventItems(db: Store, session: string) {
  return listQueuedPrompts(db, session).map(item => ({
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    ...(item.images?.length ? { images: item.images.length } : {}),
    ...(item.actor ? { actor: item.actor } : {}),
  }));
}
