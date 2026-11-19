import type { PromptContext } from '@ormicode/protocol';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Attached } from '../features/session/composer-parts.tsx';

export interface ComposerInboxMessage {
  text?: string;
  context?: PromptContext[];
  images?: Attached[];
  send?: boolean;
}

type Listener = (message: ComposerInboxMessage) => void;
const listeners = new Map<string, Set<Listener>>();

export function pushToComposer(session: string, message: ComposerInboxMessage): void {
  for (const listener of listeners.get(session) ?? []) listener(message);
}

export function subscribeToComposer(session: string, listener: Listener): () => void {
  let subscribers = listeners.get(session);
  if (!subscribers) { subscribers = new Set(); listeners.set(session, subscribers); }
  subscribers.add(listener);
  return () => {
    subscribers?.delete(listener);
    if (!subscribers?.size) listeners.delete(session);
  };
}

export function useComposerInbox(session: string, options: {
  text: string; context: PromptContext[]; images: Attached[];
  setText: Dispatch<SetStateAction<string>>; setContext: Dispatch<SetStateAction<PromptContext[]>>;
  addImages(images: Attached[]): void;
  send(draft: { text: string; context: PromptContext[]; images: Attached[] }): void;
}): void {
  const current = useRef(options);
  current.current = options;
  useEffect(() => subscribeToComposer(session, message => {
    const state = current.current;
    const text = message.text ? `${state.text}${state.text.trim() ? '\n' : ''}${message.text}` : state.text;
    const context = message.context?.length
      ? [...state.context, ...message.context.filter(item => !state.context.some(existing => JSON.stringify(existing) === JSON.stringify(item)))]
      : state.context;
    const images = [...state.images, ...(message.images ?? [])];
    if (message.text) state.setText(text);
    if (message.context?.length) state.setContext(context);
    if (message.images?.length) state.addImages(message.images);
    if (message.send) state.send({ text, context, images });
  }), [session]);
}
