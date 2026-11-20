import { useEffect, useState } from 'react';
import type { DesignDocument, DesignOperation } from '@ormicode/protocol';
import { framesOnPage, pagesOf, startFrameOf } from './design-pages.ts';

export function useDesignPages(document: DesignDocument | null, boardKey: string, mutate: (operations: DesignOperation[]) => Promise<unknown>) {
  const [selection, setSelection] = useState({ boardKey, id: 'default' });
  const pages = pagesOf(document);
  const active = pages.find(page => selection.boardKey === boardKey && page.id === selection.id) ?? pages[0]!;
  useEffect(() => { setSelection(current => current.boardKey === boardKey && current.id === active.id ? current : { boardKey, id: active.id }); }, [boardKey, active.id]);
  return {
    pages, active, frames: framesOnPage(document?.frames ?? [], active.id), start: startFrameOf(active, document?.frames ?? []),
    select: (id: string) => setSelection({ boardKey, id }),
    act: (operation: DesignOperation) => void mutate([operation]),
  };
}
