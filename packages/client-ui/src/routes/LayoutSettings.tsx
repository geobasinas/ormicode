import { useEffect, useState } from 'react';
import { appendLayoutHistory, defaultLayout, revertLayout, validateLayout, type LayoutDescriptor, type LayoutHistoryEntry } from '../lib/layout.ts';

const LAYOUT_KEY = 'ormi.layout';
const HISTORY_KEY = 'ormi.layout.history';
const control = { height: 26, boxSizing: 'border-box' as const, padding: '0 8px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 11 };

function stored(): LayoutDescriptor {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(LAYOUT_KEY) ?? 'null');
    return validateLayout(value).ok ? value as LayoutDescriptor : value ?? defaultLayout;
  } catch { return defaultLayout; }
}

export function LayoutSettings({ safeMode, onSafeMode }: { safeMode: boolean; onSafeMode(value: boolean): void }) {
  const [layout, setLayout] = useState<LayoutDescriptor>(stored);
  const [history, setHistory] = useState<LayoutHistoryEntry[]>(() => {
    try { return JSON.parse(globalThis.localStorage?.getItem(HISTORY_KEY) ?? '[]') as LayoutHistoryEntry[]; } catch { return []; }
  });
  const validation = validateLayout(layout);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify(layout));
        globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch { /* private mode */ }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [layout, history]);

  const save = (next: LayoutDescriptor) => {
    const descriptor = { ...next, source: 'user' };
    setLayout(descriptor);
    setHistory(appendLayoutHistory(history, descriptor));
    window.dispatchEvent(new CustomEvent('ormi-layout-change', { detail: descriptor }));
  };

  return <>
    {!validation.ok || validation.unknown.length ? <div role="status" style={{ marginTop: 12, padding: '8px 10px', border: '1px solid var(--line-card)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 11 }}>
      Invalid stored layout — using safe defaults. {[...validation.errors, ...validation.unknown.map(id => `unknown region ${id}`)].join(' · ')}
    </div> : null}
    <section style={group}>
      <div style={caption}>SAFETY</div>
      <div style={card}>
        <Row title="Safe mode" hint="Ignore layouts an agent publishes; your own changes still apply">
          <button role="switch" aria-checked={safeMode} onClick={() => onSafeMode(!safeMode)} style={switchStyle(safeMode)}><span style={knob} /></button>
        </Row>
      </div>
    </section>
    <section style={group}>
      <div style={caption}>HISTORY</div>
      <div style={card}>
        {history.map((entry, index) => <Row key={`${entry.timestamp}-${index}`} title={relativeTime(entry.timestamp)} tooltip={new Date(entry.timestamp).toLocaleString()}>
          <span style={sourceTag}>{entry.source}</span>
          <button style={actionButton} onClick={() => { const value = revertLayout(history, index); if (value) save(value); }}>Revert to this</button>
        </Row>)}
        {!history.length ? <Row title="No layout changes yet" /> : null}
        <Row title="Reset to defaults"><button style={actionButton} onClick={() => save(defaultLayout)}>Reset to defaults</button></Row>
      </div>
    </section>
  </>;
}

function Row({ title, hint, tooltip, children }: { title: string; hint?: string; tooltip?: string; children?: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '7px 12px', borderTop: '1px solid var(--line-card)' }}>
    <div title={tooltip} style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-title)' }}>{title}{hint ? <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-hint)' }}>{hint}</div> : null}</div>{children}
  </div>;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const group = { marginTop: 18 };
const caption = { marginBottom: 7, fontSize: 10, fontWeight: 500, letterSpacing: 1, color: 'var(--text-label)' };
const card = { overflow: 'hidden', border: '1px solid var(--line-card)', borderRadius: 9, background: 'var(--bg-card)' };
const knob = { width: 13, height: 13, borderRadius: 99, background: 'var(--bg-main)' };
const switchStyle = (on: boolean) => ({ width: 30, height: 17, padding: 2, border: 0, borderRadius: 99, background: on ? 'var(--bg-selected)' : 'var(--bg-raised)', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', cursor: 'pointer' });
const actionButton = { ...control, cursor: 'pointer' };
const sourceTag = { padding: '2px 6px', borderRadius: 99, background: 'var(--bg-inset)', color: 'var(--text-hint)', fontSize: 9, lineHeight: 1.4 };
