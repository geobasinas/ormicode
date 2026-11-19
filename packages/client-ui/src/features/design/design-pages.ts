import type { DesignDocument, DesignFrame, DesignPage } from '@ormicode/protocol';

export const pagesOf = (document: DesignDocument | null): DesignPage[] => document?.pages ?? [{ id: 'default', name: 'Page 1' }];
export const pageOfFrame = (frame: DesignFrame): string => frame.pageId ?? 'default';
export const framesOnPage = (frames: readonly DesignFrame[], pageId: string): DesignFrame[] => frames.filter(frame => pageOfFrame(frame) === pageId);
export function startFrameOf(page: DesignPage, frames: readonly DesignFrame[]): DesignFrame | undefined {
  const items = framesOnPage(frames, page.id);
  return items.find(frame => frame.id === page.startFrameId) ?? items.toSorted((a, b) => a.y - b.y || a.x - b.x)[0];
}
