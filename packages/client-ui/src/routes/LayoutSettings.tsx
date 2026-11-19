import { useEffect, useState } from 'react';
import { appendLayoutHistory, defaultLayout, REGION_IDS, revertLayout, validateLayout, type LayoutDescriptor, type LayoutHistoryEntry } from '../lib/layout.ts';

const LAYOUT_KEY = 'ormi.layout';
const HISTORY_KEY = 'ormi.layout.history';
const regions: Record<string, string> = {
  sidebar: 'Sidebar', main: 'Main', composer: 'Composer', rightRail: 'Right rail',
  'now.widgets': 'Home widgets', 'session.panel': 'Session panel', approval: 'Approvals',
};
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
  const update = (id: typeof REGION_IDS[number], patch: Partial<NonNullable<LayoutDescriptor['regions'][typeof REGION_IDS[number]]>>) =>
    save({ ...layout, regions: { ...layout.regions, [id]: { order: 0, ...layout.regions[id], ...patch } } });
  const ordered = [...REGION_IDS].sort((a, b) => (layout.regions[a]?.order ?? 0) - (layout.regions[b]?.order ?? 0));

  return <>
    {!validation.ok || validation.unknown.length ? <div role="status" style={{ marginTop: 12, padding: '8px 10px', border: '1px solid var(--line-card)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 11 }}>
      Invalid stored layout — using safe defaults. {[...validation.errors, ...validation.unknown.map(id => `unknown region ${id}`)].join(' · ')}
    </div> : null}
    <section style={group}>
      <div style={caption}>SAFETY</div>
      <div style={card}>
        <Row title="Safe mode" hint="Ignore layouts whose source is not user">
          <button role="switch" aria-checked={safeMode} onClick={() => onSafeMode(!safeMode)} style={switchStyle(safeMode)}><span style={knob} /></button>
        </Row>
      </div>
    </section>
    <section style={group}>
      <div style={caption}>REGIONS</div>
      <div style={card}>{ordered.map((id, index) => {
        const region = layout.regions[id] ?? { order: index };
        return <Row key={id} title={regions[id]!} hint={id === 'approval' ? "Approvals can't be hidden" : undefined}>
          {id === 'approval' ? <span style={hintStyle}>Always shown</span> : <button role="switch" aria-checked={region.visible !== false} onClick={() => update(id, { visible: region.visible === false })} style={switchStyle(region.visible !== false)}><span style={knob} /></button>}
          {id !== 'approval' ? <button role="switch" aria-label={`Collapse ${regions[id]}`} aria-checked={region.collapsed === true} onClick={() => update(id, { collapsed: region.collapsed !== true })} style={switchStyle(region.collapsed === true)}><span style={knob} /></button> : null}
          <button aria-label={`Move ${regions[id]} up`} disabled={index === 0} onClick={() => update(id, { order: region.order - 1 })} style={orderButton}>↑</button>
          <button aria-label={`Move ${regions[id]} down`} disabled={index === REGION_IDS.length - 1} onClick={() => update(id, { order: region.order + 1 })} style={orderButton}>↓</button>
          {region.size !== undefined ? <input aria-label={`${regions[id]} size`} type="number" min={id === 'approval' ? 48 : 80} value={region.size} onChange={event => update(id, { size: Number(event.target.value) })} style={{ ...control, width: 66 }} /> : null}
          {id === 'now.widgets' ? <span style={{ display: 'inline-flex', gap: 3 }}>{(region.widgets ?? ['recent', 'needs']).map((widget, widgetIndex, widgets) =>
            <span key={widget} style={{ display: 'inline-flex', gap: 2 }}>
              <button aria-label={`Move ${widget === 'recent' ? 'Recent sessions' : 'Needs you'} up`} disabled={widgetIndex === 0} onClick={() => update(id, { widgets: swap(widgets, widgetIndex, widgetIndex - 1) })} style={orderButton}>↑</button>
              <button aria-label={`Move ${widget === 'recent' ? 'Recent sessions' : 'Needs you'} down`} disabled={widgetIndex === widgets.length - 1} onClick={() => update(id, { widgets: swap(widgets, widgetIndex, widgetIndex + 1) })} style={orderButton}>↓</button>
            </span>)}</span> : null}
        </Row>;
      })}</div>
    </section>
    <section style={group}>
      <div style={caption}>HISTORY</div>
      <div style={card}>
        {history.map((entry, index) => <Row key={`${entry.timestamp}-${index}`} title={new Date(entry.timestamp).toLocaleString()} hint={`Source: ${entry.source}`}>
          <button style={actionButton} onClick={() => { const value = revertLayout(history, index); if (value) save(value); }}>Revert to this</button>
        </Row>)}
        {!history.length ? <Row title="No layout changes yet" /> : null}
        <Row title="Reset to defaults"><button style={actionButton} onClick={() => save(defaultLayout)}>Reset to defaults</button></Row>
      </div>
    </section>
  </>;
}

function swap<T>(values: T[], from: number, to: number): T[] {
  if (to < 0 || to >= values.length) return values;
  const next = [...values]; [next[from], next[to]] = [next[to]!, next[from]!]; return next;
}

function Row({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '7px 12px', borderTop: '1px solid var(--line-card)' }}>
    <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-title)' }}>{title}{hint ? <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-hint)' }}>{hint}</div> : null}</div>{children}
  </div>;
}

const group = { marginTop: 18 };
const caption = { marginBottom: 7, fontSize: 10, fontWeight: 600, letterSpacing: 1, color: 'var(--text-label)' };
const card = { overflow: 'hidden', border: '1px solid var(--line-card)', borderRadius: 9, background: 'var(--bg-card)' };
const knob = { width: 13, height: 13, borderRadius: 99, background: 'var(--bg-main)' };
const switchStyle = (on: boolean) => ({ width: 30, height: 17, padding: 2, border: 0, borderRadius: 99, background: on ? 'var(--accent-mint)' : 'var(--bg-raised)', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', cursor: 'pointer' });
const orderButton = { ...control, width: 26, padding: 0, cursor: 'pointer' };
const actionButton = { ...control, cursor: 'pointer' };
const hintStyle = { fontSize: 10, color: 'var(--text-hint)' };
