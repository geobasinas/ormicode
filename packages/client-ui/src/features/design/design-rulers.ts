import type { View } from './design-model.ts';

export const guideAxisFromRuler = (ruler: 'x' | 'y'): 'x' | 'y' => ruler === 'x' ? 'y' : 'x';
export function isGuideRemoval(axis: 'x' | 'y', point: { x: number; y: number }, rulersVisible: boolean): boolean {
  return rulersVisible && point[axis] >= 0 && point[axis] <= 22 && point[axis === 'x' ? 'y' : 'x'] >= 0;
}

export function gridStep(scale: number): number {
  const desired = 80 / scale;
  const power = 10 ** Math.floor(Math.log10(desired));
  return [1, 2, 5, 10].map(value => value * power).find(value => value >= desired)!;
}
export const documentToScreen = (at: number, offset: number, scale: number) => offset + at * scale;
export const screenToDocument = (at: number, offset: number, scale: number) => (at - offset) / scale;
export function rulerTicks(length: number, offset: number, scale: number) {
  const major = gridStep(scale);
  const step = major / 5;
  const first = Math.ceil(screenToDocument(0, offset, scale) / step);
  const last = Math.floor(screenToDocument(length, offset, scale) / step);
  return Array.from({ length: Math.max(0, Math.min(1000, last - first + 1)) }, (_, index) => {
    const tick = first + index;
    return { at: tick * step, screen: documentToScreen(tick * step, offset, scale), major: tick % 5 === 0 };
  });
}
export const pointInDocument = (x: number, y: number, view: View) => ({ x: screenToDocument(x, view.x, view.scale), y: screenToDocument(y, view.y, view.scale) });
