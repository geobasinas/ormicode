import { useState, type RefObject } from 'react';
import { activeMentionQuery, mentionToken, type MentionableSession } from './review-model.ts';
import './review.css';

export function ReviewComposer({ sessions, label, button, disabled, inputRef, onSubmit }: {
  sessions: MentionableSession[]; label: string; button: string; disabled: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>; onSubmit(text: string): Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = dismissed ? null : activeMentionQuery(text, caret);
  const matches = query ? sessions.filter(item => `${item.title ?? ''} ${mentionToken(item)} ${item.id}`.toLowerCase().includes(query.query.toLowerCase())).slice(0, 8) : [];
  const insert = (session: MentionableSession, textarea: HTMLTextAreaElement | null) => {
    if (!query) return;
    const token = `@${mentionToken(session, sessions)} `;
    const nextCaret = query.start + token.length;
    setText(text.slice(0, query.start) + token + text.slice(query.end)); setCaret(nextCaret); setDismissed(true);
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(nextCaret, nextCaret); });
  };
  return <form className="review-composer" onSubmit={event => { event.preventDefault(); if (text.trim() && !disabled) void onSubmit(text).then(ok => { if (ok) { setText(''); setCaret(0); } }); }}>
    <textarea ref={inputRef} className="design-input" aria-label={label} rows={3} maxLength={2000} placeholder="Leave a note… @mention a session" value={text} disabled={disabled}
      onChange={event => { setText(event.target.value); setCaret(event.target.selectionStart); setIndex(0); setDismissed(false); }}
      onSelect={event => setCaret(event.currentTarget.selectionStart)}
      onKeyDown={event => {
        if (!matches.length) return;
        if (event.key === 'Escape') { event.preventDefault(); setDismissed(true); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => (value + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); }
        if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insert(matches[index % matches.length], event.currentTarget); }
      }} />
    {matches.length ? <div className="review-mentions" role="listbox" aria-label="Mention sessions">{matches.map((item, i) => <button key={item.id} type="button" role="option" aria-selected={i === index % matches.length}
      onMouseDown={event => event.preventDefault()} onClick={event => insert(item, event.currentTarget.closest('form')?.querySelector('textarea') ?? null)}>
      <strong>{item.title || item.id}</strong><small>{item.vendor} · {item.id.slice(-6)}</small>
    </button>)}</div> : null}
    <button className="design-button" type="submit" disabled={disabled || !text.trim()}>{button}</button>
  </form>;
}
