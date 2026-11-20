import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';

export function useComposerHeight(area: RefObject<HTMLTextAreaElement | null>, text: string, maxHeight: number, compact: boolean) {
  const grow = useCallback(() => {
    const element = area.current;
    if (!element?.clientWidth) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  }, [area, maxHeight]);
  useLayoutEffect(grow, [grow, text]);
  useEffect(() => {
    const container = area.current?.parentElement;
    if (!compact || !container) return;
    let width = 0;
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === width) return;
      width = container.clientWidth;
      grow();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [area, compact, grow]);
  return grow;
}
