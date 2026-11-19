import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import { compactTokens } from '../../lib/format.ts';
import { AgentChip } from './pickers.tsx';
import { useModels } from './useModels.ts';
import type { SessionDetails } from './useSession.ts';

type Mode = 'in_place' | 'rehydrate' | 'fork';

export function HandoffDialog({ session, details, open, onClose, onOpenSession }: {
  session: string; details: SessionDetails | undefined; open: boolean;
  onClose(): void; onOpenSession?(session: string): void;
}) {
  const { transport } = usePlatform();
  const [vendor, setVendor] = useState('');
  const [via, setVia] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [mode, setMode] = useState<Mode>('rehydrate');
  const [branch, setBranch] = useState('handoff');
  const [brief, setBrief] = useState('');
  const [defaultBrief, setDefaultBrief] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [estimate, setEstimate] = useState<{ briefTokens: number; contextTokens: number; filesChanged: number; usd: number | null; confirmUsd: number; confirmRequired: boolean }>();
  const [estimateError, setEstimateError] = useState('');
  const estimateRequest = useRef(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [agents, setAgents] = useState<{ vendor: string; transports: string[] }[]>([]);
  const modelList = useModels(vendor || undefined, via || undefined);
  useEffect(() => {
    if (!open) return;
    setVendor(details?.vendor ?? '');
    setVia(details?.transport ?? '');
    setModel(details?.model || 'default');
    setEffort(details?.effort || 'default');
    setMode('rehydrate');
    setBranch('handoff');
    setBrief('');
    setDefaultBrief('');
    setExpanded(false);
    setError('');
    setConfirming(false);
    void transport.request('agents.list', {}).then(res => {
      if (res.type === 'res') setAgents((res.body as { agents: typeof agents }).agents ?? []);
    });
    void transport.request('session.handoffBrief', { session }).then(res => {
      if (res.type === 'res') {
        const next = String(res.body.brief ?? '');
        setBrief(next);
        setDefaultBrief(next);
      }
    });
  }, [open, session, details?.vendor, details?.model, details?.effort, transport]);
  useEffect(() => {
    if (!open) return;
    const request = ++estimateRequest.current;
    setEstimate(undefined);
    setEstimateError('');
    setConfirming(false);
    const timer = setTimeout(() => {
      void transport.request('session.handoffEstimate', {
        session, to: { vendor: vendor || undefined, transport: via || undefined, model: model || undefined, effort: effort || undefined }, mode, brief,
      })
        .then(res => {
          if (request !== estimateRequest.current) return;
          if (res.type === 'res') setEstimate(res.body as typeof estimate);
          else setEstimateError(`${res.code}: ${res.message ?? res.code}`);
        })
        .catch(error => {
          if (request === estimateRequest.current) setEstimateError(String(error));
        });
    }, 80);
    return () => { clearTimeout(timer); };
  }, [open, session, vendor, via, model, effort, mode, brief, transport]);
  if (!open) return null;
  const submit = async () => {
    if (estimate?.confirmRequired && !confirming) { setConfirming(true); return; }
    setBusy(true); setError('');
    const res = await transport.request('session.handoff', {
      session, to: { vendor: vendor || undefined, transport: via || undefined, model: model || undefined, effort: effort || undefined, branch: mode === 'fork' ? branch : undefined },
      mode, brief, ...(confirming ? { confirmed: true } : {}),
    });
    setBusy(false);
    if (res.type === 'err') { setError(String(res.message ?? res.code)); return; }
    const body = res.body as { session?: unknown };
    onClose();
    if (typeof body.session === 'string' && body.session !== session) onOpenSession?.(body.session);
  };
  const usd = estimate?.usd;
  const briefTokens = estimate?.briefTokens ?? Math.ceil(brief.length / 4);
  const totalTokens = (estimate?.briefTokens ?? 0) + (estimate?.contextTokens ?? 0);
  const modeDescription = mode === 'in_place' ? 'Same agent, keeps context'
    : mode === 'rehydrate' ? 'New agent continues from a brief'
      : 'New branch, current session keeps going';
  const modes: Mode[] = details?.project === 'scratch' ? ['in_place', 'rehydrate'] : ['in_place', 'rehydrate', 'fork'];
  const primaryLabel = confirming
    ? `Hand off · ${usd == null ? 'cost unknown' : `$${usd.toFixed(2)}`}`
    : estimate?.confirmRequired ? 'Review estimate' : 'Hand off';
  return <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} style={{
    position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.42)', display: 'grid', placeItems: 'center', padding: 20,
  }}>
    <section role="dialog" aria-modal="true" aria-label="Hand off session" style={{
      width: 'min(440px, 100%)', maxHeight: '85vh', overflow: 'auto', background: 'var(--bg-card)',
      border: '1px solid var(--line-card)', borderRadius: 12, padding: 24, color: 'var(--text-active)', boxShadow: '0 16px 48px rgba(0,0,0,.3)',
    }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Hand off to another agent</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 24, flexShrink: 0, fontSize: 11.5, color: 'var(--text-secondary)' }}>To</span>
        <AgentChip title="agent, model and effort" vendor={vendor} via={via} agents={agents}
        onPick={(nextVendor, nextVia) => { setVendor(nextVendor); setVia(nextVia); setModel('default'); setEffort('default'); }}
        model={model || 'default'} models={modelList.models} onModel={setModel}
        effort={effort || 'default'} onEffort={setEffort} loading={modelList.loading} refresh={modelList.refresh}
        fullWidth showDefaults />
      </div>
      <div role="group" aria-label="Handoff mode" style={{ display: 'flex', width: '100%', gap: 2, padding: 2, boxSizing: 'border-box', marginTop: 12, background: 'var(--bg-inset)', borderRadius: 8 }}>
        {modes.map(value => {
          const disabled = value === 'in_place' && (vendor !== details?.vendor || via !== details?.transport);
          return <button key={value} disabled={disabled}
            aria-pressed={mode === value}
            onClick={() => setMode(value)} style={{
              flex: 1, minWidth: 0, height: 28, border: 0, borderRadius: 6, padding: '0 4px',
              font: 'inherit', fontSize: 11.5, cursor: disabled ? 'not-allowed' : 'pointer',
              color: mode === value ? 'var(--text-active)' : 'var(--text-hint)',
              background: mode === value ? 'var(--bg-raised)' : 'transparent', opacity: disabled ? .45 : 1,
            }}>
            {value === 'in_place' ? 'In place' : value === 'rehydrate' ? 'Rehydrate' : 'Fork'}
          </button>;
        })}
      </div>
      <div style={{ minHeight: 16, marginTop: 6, fontSize: 11, color: 'var(--text-hint)' }}>{modeDescription}</div>
      {mode === 'fork' ? <label style={{ display: 'block', marginTop: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
        Branch name
        <input aria-label="Branch name" value={branch} onChange={e => setBranch(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
      </label> : null}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 28, border: 0, background: 'transparent',
            padding: 0, color: 'var(--text-secondary)', font: 'inherit', fontSize: 12, cursor: 'pointer',
          }}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Brief · ~{compactTokens(briefTokens)} tokens
          </button>
          {brief !== defaultBrief ? <button type="button" onClick={() => setBrief(defaultBrief)} style={{
            marginLeft: 'auto', border: 0, background: 'transparent', padding: '4px 0', color: 'var(--text-hint)',
            font: 'inherit', fontSize: 11, cursor: 'pointer',
          }}>Reset</button> : null}
        </div>
        {expanded ? <textarea aria-label="Handoff brief" value={brief} onChange={e => setBrief(e.target.value)} rows={8} style={{
          display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 144, maxHeight: 288, marginTop: 6,
          padding: '8px 10px', border: '1px solid var(--line-card)', borderRadius: 7, background: 'var(--bg-inset)',
          color: 'var(--text-active)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5,
          resize: 'vertical', overflow: 'auto', outline: 'none',
        }} /> : null}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 10px',
        border: '1px solid var(--line-card)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 11,
      }}>
        <span style={{ flex: 1, minWidth: 0 }}>~{compactTokens(totalTokens)} tokens</span>
        <span style={{ color: 'var(--text-hint)' }}>·</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>{estimate?.filesChanged ?? 0} file{estimate?.filesChanged === 1 ? '' : 's'}</span>
        <span style={{ color: 'var(--text-hint)' }}>·</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>{estimate ? (usd == null ? 'cost unknown' : `~$${usd.toFixed(2)}`) : 'estimating…'}</span>
      </div>
      {estimate?.confirmRequired ? <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 11, color: 'var(--accent-amber)' }}>
        <AlertCircle size={12} />Above the ${estimate.confirmUsd.toFixed(2)} confirmation limit
      </div> : null}
      {estimateError ? <div style={{ marginTop: 8, color: 'var(--accent-red)', fontSize: 11 }}>{estimateError}</div> : null}
      {error ? <div style={{ marginTop: 8, color: 'var(--accent-red)', fontSize: 12 }}>{error}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
        <button onClick={onClose} style={segmentStyle}>Cancel</button>
        <button disabled={busy || !vendor || !estimate} onClick={() => void submit()} style={{ ...segmentStyle, background: 'var(--text-title)', color: 'var(--bg-main)', fontWeight: 600 }}>{busy ? 'Handing off…' : primaryLabel}</button>
      </div>
    </section>
  </div>;
}

const inputStyle = { display: 'block', width: '100%', boxSizing: 'border-box' as const, height: 30, marginTop: 4, padding: '0 8px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 12, outline: 'none' };
const segmentStyle = { border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-secondary)', font: 'inherit', fontSize: 12, padding: '6px 10px', cursor: 'pointer' };
