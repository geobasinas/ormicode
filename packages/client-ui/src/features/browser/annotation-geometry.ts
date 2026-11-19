export function annotationLabelCenterY(boxTop: number, boxBottom: number, labelHeight: number, gap: number, badgeRadius: number, frameHeight: number) {
  const extent = Math.max(labelHeight / 2, badgeRadius);
  const center = boxTop >= extent + gap ? boxTop - gap - extent : boxBottom + gap + extent;
  const min = Math.min(extent, frameHeight / 2);
  const max = Math.max(min, frameHeight - extent);
  return Math.max(min, Math.min(max, center));
}

export function annotationLabelLeft(preferredLeft: number, labelWidth: number, frameWidth: number, inset = 1) {
  const edge = Math.min(Math.max(0, inset), frameWidth / 2);
  return Math.max(edge, Math.min(Math.max(edge, frameWidth - edge - labelWidth), preferredLeft));
}

export function annotationEditorPosition(anchorX: number, anchorY: number, frameWidth: number, frameHeight: number, editorWidth: number, editorHeight: number, gap = 12) {
  const left = Math.max(0, Math.min(Math.max(0, frameWidth - editorWidth), anchorX - editorWidth - gap));
  const below = anchorY + gap;
  const top = below + editorHeight <= frameHeight ? below : Math.max(0, anchorY - editorHeight - gap);
  return { left, top };
}
