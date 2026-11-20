import type { DesignDocument, DesignFrame } from '@ormicode/protocol';

export type DesignInvalidation = { slug: string; revision: number };

export function designRefresh(refresh: (revisions: ReadonlyMap<string, number>) => Promise<void>, delay = 60) {
  let pending = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let closed = false;
  const schedule = () => {
    if (closed || running || timer || !pending.size) return;
    timer = setTimeout(() => {
      timer = undefined;
      running = true;
      const batch = pending;
      pending = new Map();
      void refresh(batch).catch(() => undefined).finally(() => { running = false; schedule(); });
    }, delay);
  };
  return {
    add({ slug, revision }: DesignInvalidation) {
      if (closed) return;
      pending.set(slug, Math.max(revision, pending.get(slug) ?? 0));
      schedule();
    },
    close() { closed = true; clearTimeout(timer); pending.clear(); },
  };
}

export function acceptsDesignRevision(current: DesignDocument | null, incoming: DesignDocument, sameScope: boolean): boolean {
  return sameScope && (!current || incoming.revision > current.revision);
}

export function sourceMatches(frame: DesignFrame | undefined, base: DesignFrame | undefined): boolean {
  return Boolean(frame && base && frame.id === base.id && frame.html === base.html && frame.styles === base.styles);
}
