import { useEffect } from 'react';
import type { DesignDocument, DesignFrame } from '@ormicode/protocol';
import type { View } from '../design-model.ts';
import { annotationAnchor, approvalLabel, type CommentTarget, type ReviewComment } from './review-model.ts';
import './review.css';

export function DesignAnnotations({ document, frames: pageFrames, pageId, view, commenting, frameRect, onTarget, onThread, onCancel }: {
  document: DesignDocument; frames: DesignFrame[]; pageId: string; view: View; commenting: boolean; frameRect(frame: DesignFrame): DesignFrame | { x: number; y: number; width: number; height: number };
  onTarget(target: CommentTarget): void; onThread(comment: ReviewComment): void; onCancel(): void;
}) {
  useEffect(() => {
    if (!commenting) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [commenting, onCancel]);
  const frames = pageFrames.map(frame => ({ ...frame, ...frameRect(frame) }));
  const open = document.comments.filter(comment => !comment.resolved && (comment.frameId !== null || (comment.pageId ?? 'default') === pageId));
  return <>
    <div className="review-annotations">
      {open.map((comment, index) => {
        const stack = open.slice(0, index).filter(item => item.frameId === comment.frameId && (!item.point || item.path)).length;
        const anchor = annotationAnchor(comment, frames, stack);
        return anchor ? <button type="button" className="review-pin" key={comment.id} style={{ left: view.x + anchor.x * view.scale, top: view.y + anchor.y * view.scale }}
          aria-label={`Open comment ${index + 1}: ${comment.text}`} title={comment.text} onPointerDown={event => event.stopPropagation()} onClick={() => onThread(comment)}>{index + 1}</button> : null;
      })}
      {frames.filter(frame => frame.approval).map(frame => <span key={frame.id} className="review-badge review-frame-badge" data-status={frame.approval?.status}
        style={{ left: view.x + (frame.x + frame.width) * view.scale, top: view.y + frame.y * view.scale - 30 }}>{approvalLabel(frame)}</span>)}
    </div>
    {commenting ? <div className="review-capture" aria-label="Place comment on canvas" onPointerDown={event => {
      event.preventDefault(); event.stopPropagation();
      if (event.button !== 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.max(-100000, Math.min(100000, Math.round((event.clientX - rect.left - view.x) / view.scale)));
      const y = Math.max(-100000, Math.min(100000, Math.round((event.clientY - rect.top - view.y) / view.scale)));
      const frame = [...frames].reverse().find(item => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height);
      onTarget(frame ? { frameId: frame.id, point: { x: x - frame.x, y: y - frame.y } } : { frameId: null, pageId, point: { x, y } });
    }} /> : null}
  </>;
}
