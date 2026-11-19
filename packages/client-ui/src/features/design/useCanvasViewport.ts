import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fitCanvas, zoomAt, type Rect, type View } from './design-model.ts';

export function useCanvasViewport() {
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const observer = new ResizeObserver(() => setCanvasSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    if (event.ctrlKey || event.metaKey) setView(current => zoomAt(current, { x: event.clientX - box.left, y: event.clientY - box.top }, Math.exp(-event.deltaY * 0.002)));
    else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }, []);
  const zoom = (factor: number) => setView(current => zoomAt(current, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, factor));
  return { canvas, view, setView, canvasSize, handleWheel, zoom };
}

export function useFitOnPageChange(key: string, fitted: RefObject<string>, frames: Rect[], size: { width: number; height: number }, setView: (view: View) => void) {
  useEffect(() => {
    if (!key || fitted.current === key || !size.width || !size.height) return;
    fitted.current = key;
    setView(fitCanvas(frames, size.width, size.height));
  }, [key, fitted, frames, size, setView]);
}
