import { randomUUID } from 'node:crypto';
import type { DesignDocument, DesignOperation } from '@ormicode/protocol';
import { DesignError } from './design-error.ts';

const fail = (message: string): never => { throw new DesignError('design.invalid', message); };
export function materializePages(document: DesignDocument): void {
  if (document.pages) return;
  document.pages = [{ id: 'default', name: 'Page 1' }];
  for (const frame of document.frames) frame.pageId ??= 'default';
}

export function validatePages(document: DesignDocument): void {
  const pages = document.pages;
  if (!pages) {
    if (document.frames.some(frame => frame.pageId !== undefined)) fail('Frame pages require pages');
    return;
  }
  if (!pages.length || new Set(pages.map(page => page.id)).size !== pages.length) fail('Invalid page IDs');
  if (document.frames.some(frame => !pages.some(page => page.id === frame.pageId))) fail('Frame page does not exist');
  for (const page of pages) {
    if (page.startFrameId && !document.frames.some(frame => frame.id === page.startFrameId && frame.pageId === page.id)) fail('Start frame must belong to page');
    const guides = page.guides ?? [];
    if (new Set(guides.map(guide => guide.id)).size !== guides.length) fail('Duplicate guide IDs');
  }
}

export function clearPageStart(document: DesignDocument, frameId: string): void {
  for (const page of document.pages ?? []) if (page.startFrameId === frameId) delete page.startFrameId;
}

export function applyPageOperation(document: DesignDocument, op: DesignOperation): boolean {
  if (!op.type.startsWith('page.') && !op.type.startsWith('guide.')) return false;
  materializePages(document);
  const pages = document.pages!;
  if (op.type === 'page.add') {
    pages.push({ id: randomUUID(), name: op.name, ...(op.background ? { background: op.background } : {}) });
    return true;
  }
  if (!('pageId' in op)) return false;
  const page = pages.find(page => page.id === op.pageId) ?? fail('Page not found');
  switch (op.type) {
    case 'page.rename': page.name = op.name; break;
    case 'page.move': pages.splice(pages.indexOf(page), 1); pages.splice(Math.min(op.index, pages.length), 0, page); break;
    case 'page.background': if (op.background === null) delete page.background; else page.background = op.background; break;
    case 'page.start':
      if (op.frameId === null) delete page.startFrameId;
      else {
        if (!document.frames.some(frame => frame.id === op.frameId && frame.pageId === page.id)) fail('Start frame must belong to page');
        page.startFrameId = op.frameId;
      }
      break;
    case 'page.duplicate': {
      const copy = { ...page, id: randomUUID(), name: `${page.name.slice(0, 115)} copy`, guides: page.guides?.map(guide => ({ ...guide, id: randomUUID() })) };
      const frames = document.frames.filter(frame => frame.pageId === page.id).map(frame => {
        const id = randomUUID();
        if (frame.id === page.startFrameId) copy.startFrameId = id;
        return { ...frame, id, pageId: copy.id };
      });
      if (document.frames.length + frames.length > 24) fail('At most 24 frames are supported');
      pages.splice(pages.indexOf(page) + 1, 0, copy); document.frames.push(...frames); break;
    }
    case 'page.remove': {
      if (pages.length === 1) fail('Cannot remove the last page');
      const removed = new Set(document.frames.filter(frame => frame.pageId === page.id).map(frame => frame.id));
      document.frames = document.frames.filter(frame => !removed.has(frame.id));
      document.comments = document.comments.filter(comment => !comment.frameId || !removed.has(comment.frameId));
      if (document.workingFrameId && removed.has(document.workingFrameId)) document.workingFrameId = null;
      pages.splice(pages.indexOf(page), 1); break;
    }
    case 'guide.add': (page.guides ??= []).push({ id: randomUUID(), axis: op.axis, at: op.at }); break;
    case 'guide.move': case 'guide.remove': {
      const guide = page.guides?.find(guide => guide.id === op.guideId) ?? fail('Guide not found');
      if (op.type === 'guide.move') guide.at = op.at;
      else page.guides = page.guides!.filter(item => item !== guide);
      break;
    }
  }
  return true;
}
