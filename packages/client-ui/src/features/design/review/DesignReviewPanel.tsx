import { useEffect, useRef, useState } from 'react';
import type { DesignDocument } from '@ormicode/protocol';
import type { DesignReview } from './useDesignReview.ts';
import { actorLabel, filterThreads, relativeTime, targetLabel, type CommentTarget, type ReviewComment } from './review-model.ts';
import { ReviewComposer } from './ReviewComposer.tsx';
import './review.css';

export function DesignReviewPanel({ document, review, target, disabled, onThread, onChat }: {
  document: DesignDocument; review: DesignReview; target: CommentTarget; disabled: boolean;
  onThread(comment: ReviewComment): void; onChat(text: string): void;
}) {
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const threads = filterThreads(document.comments, filter);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const selected = document.comments.find(comment => comment.id === review.thread);
    if (selected) setFilter(selected.resolved ? 'resolved' : 'open');
  }, [review.thread, review.threadFocus, document.comments]);
  useEffect(() => {
    if (review.thread) root.current?.querySelector<HTMLElement>('[data-thread-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [review.thread, review.threadFocus, filter]);
  const chips = (mentions: string[] = []) => <div className="review-chips">{mentions.map(id => <span key={id}>@{review.sessions.find(item => item.id === id)?.title || id}</span>)}</div>;
  return <section className="review-panel" ref={root}>
    <section className="design-properties">
      <div className="review-heading"><h3>New comment</h3>{review.pending ? <button type="button" className="design-button" onClick={() => review.setPending(null)}>Clear target</button> : null}</div>
      <small className="review-target">{targetLabel(target, document.frames)}</small>
      <ReviewComposer key={document.name} sessions={review.sessions} label="Review comment" button="Post comment" disabled={disabled} inputRef={review.composer} onSubmit={text => review.add(target, text)} />
      {review.mentionError ? <small role="status">Mentions unavailable: {review.mentionError}</small> : null}
    </section>
    <div className="review-filters" role="group" aria-label="Filter threads">{(['open', 'resolved'] as const).map(value => <button type="button" key={value} className="design-button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'open' ? 'Open' : 'Resolved'} · {filterThreads(document.comments, value).length}</button>)}</div>
    {!threads.length ? <p className="design-inspector-hint">{filter === 'open' ? 'No open threads. Add a comment or drop a pin on the canvas.' : 'No resolved threads.'}</p> : null}
    {threads.map(comment => <article className="review-thread" key={comment.id} data-thread-active={review.thread === comment.id}>
      <header><strong>{actorLabel(comment.author, review.sessions, comment.session)}</strong><time title={new Date(comment.createdAt).toLocaleString()}>{relativeTime(comment.createdAt)}</time></header>
      <button type="button" className="review-thread-target" onClick={() => { review.setThread(comment.id); onThread(comment); }}>{targetLabel(comment, document.frames)}</button>
      <p>{comment.text}</p>{chips(comment.mentions)}
      {(comment.replies ?? []).map(reply => <div className="review-reply" key={reply.id}><header><strong>{actorLabel(reply.author, review.sessions)}</strong><time title={new Date(reply.createdAt).toLocaleString()}>{relativeTime(reply.createdAt)}</time></header><p>{reply.text}</p>{chips(reply.mentions)}</div>)}
      {comment.resolved ? <small className="review-target">Resolved{comment.resolvedBy ? ` by ${actorLabel(comment.resolvedBy, review.sessions)}` : ''}{comment.resolvedAt ? ` · ${relativeTime(comment.resolvedAt)}` : ''}</small> : null}
      <div className="design-inline">
        <button className="design-button" type="button" disabled={disabled} onClick={() => void review.resolve(comment.id, !comment.resolved)}>{comment.resolved ? 'Reopen' : 'Resolve'}</button>
        <button className="design-button" type="button" onClick={() => onChat(`Design feedback for “${document.name}”, ${targetLabel(comment, document.frames)}: ${comment.text}`)}>Add to chat</button>
        <button className="design-button" type="button" disabled={disabled} onClick={() => void review.remove(comment.id)}>Remove</button>
      </div>
      <ReviewComposer sessions={review.sessions} label={`Reply to ${comment.text.slice(0, 40)}`} button="Reply" disabled={disabled || (comment.replies?.length ?? 0) >= 50} onSubmit={text => review.reply(comment.id, text)} />
    </article>)}
  </section>;
}
