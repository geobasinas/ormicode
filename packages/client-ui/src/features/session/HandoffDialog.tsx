import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../lib/platform.ts';
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
    setError('');
    setConfirming(false);
    void transport.request('agents.list', {}).then(res => {
      if (res.type === 'res') setAgents((res.body as { agents: typeof agents }).agents ?? []);
    });
    void transport.request('session.handoffBrief', { session }).then(res => {
      if (res.type === 'res') setBrief(String(res.body.brief ?? ''));
    });
  }, [open, session, details?.vendor, details?.model, details?.effort, transport]);
  useEffect(() => {
    if (!open) return;
    const request = ++estimateRequest.current;
    setEstimate(undefined);
    setEstimateError('');
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
  return <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} style={{
    position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.42)', display: 'grid', placeItems: 'center', padding: 20,
  }}>
    <section role="dialog" aria-modal="true" aria-label="Hand off session" style={{
      width: 'min(460px, 100%)', maxHeight: '85vh', overflow: 'auto', background: 'var(--bg-card)',
      border: '1px solid var(--line-card)', borderRadius: 12, padding: 18, color: 'var(--text-active)', boxShadow: '0 16px 48px rgba(0,0,0,.3)',
    }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Hand off to another agent</div>
      <AgentChip title="agent, model and effort" vendor={vendor} via={via} agents={agents}
        onPick={(nextVendor, nextVia) => { setVendor(nextVendor); setVia(nextVia); setModel('default'); setEffort('default'); }}
        model={model || 'default'} models={modelList.models} onModel={setModel}
        effort={effort || 'default'} onEffort={setEffort} loading={modelList.loading} refresh={modelList.refresh} />
      <div style={{ display: 'flex', gap: 5, margin: '12px 0' }}>
        {(['in_place', 'rehydrate', 'fork'] as Mode[]).map(value => {
          const disabled = value === 'in_place' && (vendor !== details?.vendor || via !== details?.transport);
          return <button key={value} disabled={disabled}
          onClick={() => setMode(value)} style={{ ...segmentStyle, color: mode === value ? 'var(--text-active)' : 'var(--text-hint)', background: mode === value ? 'var(--bg-raised)' : 'transparent', opacity: disabled ? .45 : 1 }}>
          {value === 'in_place' ? 'In place' : value === 'rehydrate' ? 'Rehydrate' : 'Fork'}
        </button>;
        })}
      </div>
      {mode === 'fork' ? <input aria-label="Branch name" value={branch} onChange={e => setBranch(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} /> : null}
      <button onClick={() => setExpanded(value => !value)} style={{ border: 0, background: 'transparent', padding: '4px 0', color: 'var(--text-secondary)', font: 'inherit', fontSize: 12, cursor: 'pointer' }}>
        {expanded ? 'Hide' : 'Edit'} handoff brief
      </button>
      {expanded ? <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={7} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 11 }} /> : null}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        {estimate ? `~${((estimate.briefTokens ?? 0) + (estimate.contextTokens ?? 0)).toLocaleString()} tokens · ${estimate.filesChanged ?? 0} files · ${usd === null ? 'cost unknown' : `~$${(usd ?? 0).toFixed(2)}`}` : estimateError ? `Estimate unavailable: ${estimateError}` : 'Estimating…'}
      </div>
      {estimate?.confirmRequired ? <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent-amber)' }}>Above the ${estimate.confirmUsd.toFixed(2)} confirmation limit</div> : null}
      {error ? <div style={{ marginTop: 8, color: 'var(--accent-red)', fontSize: 12 }}>{error}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 14 }}>
        <button onClick={onClose} style={segmentStyle}>Cancel</button>
        <button disabled={busy || !vendor || !estimate} onClick={() => void submit()} style={{ ...segmentStyle, background: 'var(--text-title)', color: 'var(--bg-main)', fontWeight: 600 }}>{busy ? 'Handing off…' : confirming ? 'Confirm handoff' : estimate?.confirmRequired ? 'Review handoff' : 'Hand off'}</button>
      </div>
    </section>
  </div>;
}

const inputStyle = { display: 'block', width: '100%', boxSizing: 'border-box' as const, height: 30, marginTop: 4, padding: '0 8px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-active)', font: 'inherit', fontSize: 12, outline: 'none' };
const segmentStyle = { border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-inset)', color: 'var(--text-secondary)', font: 'inherit', fontSize: 12, padding: '6px 10px', cursor: 'pointer' };
