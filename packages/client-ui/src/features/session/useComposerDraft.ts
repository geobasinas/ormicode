import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { usePlatform } from '../../lib/platform.ts';

export function useComposerDraft(key: string): {
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  ready: boolean;
} {
  const { transport } = usePlatform();
  const [text, setTextState] = useState('');
  const [ready, setReady] = useState(false);
  const edited = useRef(false);
  const setText = useCallback<Dispatch<SetStateAction<string>>>(value => {
    edited.current = true;
    setTextState(value);
  }, []);

  useEffect(() => {
    let active = true;
    edited.current = false;
    setReady(false);
    setTextState('');
    void transport.request('session.draft.get', { session: key }).then(res => {
      if (!active) return;
      const saved = res.type === 'res' && typeof res.body.text === 'string' ? res.body.text : '';
      if (!edited.current) setTextState(saved);
      setReady(true);
    }).catch(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [key, transport]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void transport.request('session.draft.set', { session: key, text }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [key, ready, text, transport]);

  return { text, setText, ready };
}
