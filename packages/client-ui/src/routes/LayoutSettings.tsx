import { useEffect, useState } from 'react';
import { appendLayoutHistory, defaultLayout, revertLayout, validateLayout, type LayoutDescriptor, type LayoutHistoryEntry } from '../lib/layout.ts';
import { Group, Row, ctl } from './SettingsRows.tsx';
import { SettingsSwitch } from './SettingsSwitch.tsx';

const LAYOUT_KEY = 'ormi.layout';
const HISTORY_KEY = 'ormi.layout.history';
const actionButton = { ...ctl, cursor: 'pointer', fontSize: 11 } as const;

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
    <Group title="SAFETY">
      <Row title="Safe mode" hint="Ignore layouts an agent publishes; your own changes still apply">
        <SettingsSwitch ariaLabel="Safe mode" on={safeMode} onChange={onSafeMode} />
      </Row>
    </Group>
    <Group title="HISTORY">
      {history.map((entry, index) => <Row key={`${entry.timestamp}-${index}`} title={relativeTime(entry.timestamp)} hint={`${entry.source} · ${new Date(entry.timestamp).toLocaleString()}`}>
        <button style={actionButton} onClick={() => { const value = revertLayout(history, index); if (value) save(value); }}>Revert</button>
      </Row>)}
      {!history.length ? <Row title="No layout changes yet" /> : null}
      <Row title="Reset to defaults" hint="Restore the built-in layout"><button style={actionButton} onClick={() => save(defaultLayout)}>Reset</button></Row>
    </Group>
  </>;
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
