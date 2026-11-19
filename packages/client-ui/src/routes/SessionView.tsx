/** Session route: header, transcript, approvals surface, composer, and
 * side panels toggled from the app-level right rail (Notes first). */
import { useEffect, useState } from 'react';
import { useTranscript } from '../features/session/useTranscript.ts';
import { useSession } from '../features/session/useSession.ts';
import { Transcript } from '../features/session/Transcript.tsx';
import { Approvals } from '../features/session/Approvals.tsx';
import { FilesPane } from '../features/files/FilesPane.tsx';
import { Composer } from '../features/session/Composer.tsx';
import { NotesPanel } from '../features/notes/NotesPanel.tsx';
import { TerminalPane } from '../features/terminal/TerminalPane.tsx';
import { GitPane } from '../features/git/GitPane.tsx';
import { BrowserPane } from '../features/browser/BrowserPane.tsx';
import type { RailPane } from './App.tsx';
import { History } from 'lucide-react';
import { compactTokens, formatUsd, projectName } from '../lib/format.ts';
import { stateLabel } from '../features/session/state.tsx';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { usePlatform } from '../lib/platform.ts';
import { HandoffDialog } from '../features/session/HandoffDialog.tsx';
import type { LayoutDescriptor } from '../lib/layout.ts';

interface SessionCost {
  input: number; output: number; cacheRead: number; cacheWrite: number; turns: number;
  usd: number | null; source: 'reported' | 'estimate' | 'none'; priceVersion: string | null; model: string | null;
}

export function SessionView({ session, rail = 'none', onRail, onOpen, handoffOpen = false, onHandoffChange, layout, onLayoutChange }: { session: string; rail?: RailPane; onRail?: (r: RailPane) => void; onOpen?: (session: string) => void; handoffOpen?: boolean; onHandoffChange?(open: boolean): void; layout?: LayoutDescriptor; onLayoutChange?(layout: LayoutDescriptor): void }) {
  const { events, approvals } = useTranscript(session);
  const details = useSession(session);
  const scratch = details?.project === 'scratch';
  const { transport } = usePlatform();
  const [cost, setCost] = useState<SessionCost>();
  const [editedPrompt, setEditedPrompt] = useState<string>();
  const notesLayout = useDefaultLayout({ id: 'ormi.session.notes', storage: globalThis.localStorage });
  const browserLayout = useDefaultLayout({ id: 'ormi.session.browser', storage: globalThis.localStorage });
  const railLayout = rail === 'browser' ? browserLayout : notesLayout;
  const onNotesLayoutChanged: typeof notesLayout.onLayoutChanged = (panelLayout, meta) => {
    railLayout.onLayoutChanged(panelLayout, meta);
    if (!meta.isUserInteraction || typeof panelLayout.notes !== 'number') return;
    const available = Math.max(0, window.innerWidth - (layout?.regions.sidebar?.size ?? 268) - 46);
    const size = Math.round(panelLayout.notes * available / 100);
    onLayoutChange?.({
      ...(layout ?? { version: 1, regions: {} }), source: 'user',
      regions: { ...layout?.regions, rightRail: { order: layout?.regions.rightRail?.order ?? 3, collapsed: layout?.regions.rightRail?.collapsed ?? true, size } },
    });
  };
  useEffect(() => { if (scratch && rail === 'git') onRail?.('none'); }, [scratch, rail, onRail]);
  const approvalsAtTop = (layout?.regions.approval?.order ?? 0) > 0;
  useEffect(() => {
    if (!details) return;
    let alive = true;
    void transport.request('session.cost', { session }).then(res => {
      if (alive && res.type === 'res') setCost(res.body as unknown as SessionCost);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [transport, session, details?.state]);
  const tokens = cost ? cost.input + cost.output + cost.cacheRead + cost.cacheWrite : 0;
  const costTitle = cost
    ? `Input ${cost.input.toLocaleString('en-US')} · Output ${cost.output.toLocaleString('en-US')} · Cache read ${cost.cacheRead.toLocaleString('en-US')} · Cache write ${cost.cacheWrite.toLocaleString('en-US')} · ${cost.turns} turns · model ${cost.model ?? '—'} · prices ${cost.priceVersion ?? '—'}${cost.source === 'estimate' ? ' (estimate)' : ''}`
    : '';
  const chat = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      {details ? <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{ width: '100%', maxWidth: 720, height: 38, padding: '0 var(--space-5)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-hint)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <History size={11} />{[projectName(details.project), details.vendor, stateLabel(details.state)].join(' · ')}
          {cost && tokens > 0 ? <span title={costTitle}> · {compactTokens(tokens)} tokens{cost.usd !== null ? ` · ${cost.source === 'estimate' ? '~' : ''}${formatUsd(cost.usd)}` : ''}</span> : null}
        </div>
      </div> : null}
      {approvalsAtTop ? <Approvals session={session} pending={approvals} events={events} /> : null}
      <Transcript events={events} session={session} scratch={scratch} busy={Boolean(details && ['starting', 'running', 'awaiting_approval', 'awaiting_input', 'retrying', 'paused_rate_limited'].includes(details.state))} onHandoff={() => onHandoffChange?.(true)} onOpenSession={onOpen} onEditPrompt={setEditedPrompt} />
      {!approvalsAtTop ? <Approvals session={session} pending={approvals} events={events} /> : null}
      <div data-session-composer style={{ minHeight: layout?.regions.composer?.size ?? 0 }}>
      <Composer session={session} details={details} onGit={scratch ? undefined : onRail ? () => onRail('git') : undefined}
        onOpenRail={onRail ? pane => onRail(pane) : undefined} onHandoff={() => onHandoffChange?.(true)}
        prefill={editedPrompt} onPrefillApplied={() => setEditedPrompt(undefined)} />
      </div>
      <HandoffDialog session={session} details={details} open={handoffOpen}
        onClose={() => onHandoffChange?.(false)} onOpenSession={onOpen} />
    </div>
  );
  if (rail === 'none' || (scratch && rail === 'git')) return <div style={{ height: '100%', background: 'var(--bg-main)' }}>{chat}</div>;
  return (
    <Group id={rail === 'browser' ? 'ormi.session.browser' : 'ormi.session.notes'} orientation="horizontal" defaultLayout={railLayout.defaultLayout} onLayoutChanged={onNotesLayoutChanged} style={{ height: '100%', background: 'var(--bg-main)' }}>
      <Panel id="chat" minSize={rail === 'browser' ? 320 : 440}>{chat}</Panel>
      <Separator className="ormi-handle ormi-handle-line" />
      <Panel id="notes" defaultSize={layout?.source === 'user' && layout.regions.rightRail?.size
        ? layout.regions.rightRail.size : rail === 'browser' ? '50' : '42'} minSize={rail === 'browser' ? 400 : 340} maxSize={rail === 'browser' ? '80' : '65'}>
        <div className="ormi-pane" style={{ height: '100%', background: 'var(--bg-main)', minWidth: 0, overflow: 'hidden' }}>
          {rail === 'notes' ? <NotesPanel session={session} /> : rail === 'git' ? <GitPane session={session} /> : rail === 'files' ? <FilesPane session={session} onOpenSession={onOpen} /> : rail === 'browser' ? <BrowserPane session={session} /> : <TerminalPane session={session} />}
        </div>
      </Panel>
    </Group>
  );
}
