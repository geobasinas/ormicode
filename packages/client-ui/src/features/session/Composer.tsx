/** Session composer — Enter sends (session.prompt; session.steer while the agent
 * is working), Shift+Enter newline. Images by picker or paste; model, effort and
 * mode chips call session.setModel/setEffort/setMode; Stop calls session.abort. */
import { useEffect, useRef, useState } from 'react';
import { Plus, AtSign, Mic, ArrowUp, Square, Cpu, Gauge, GitBranch } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';
import type { SessionDetails } from './useSession.ts';
import { useImages, ImageStrip, MenuChip, ModelChip, EffortChip, chip, iconBtn } from './composer-parts.tsx';
import { useModels } from './useModels.ts';

const LIVE = new Set(['running', 'starting', 'retrying']);

export function Composer({ session, details, onGit }: { session: string; details?: SessionDetails; onGit?: () => void }) {
  const { transport } = usePlatform();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [modelOverride, setModelOverride] = useState<string>();
  const [effortOverride, setEffortOverride] = useState<string>();
  const img = useImages();
  const modelList = useModels(details?.vendor, details?.transport);
  useEffect(() => { setModelOverride(undefined); }, [session, details?.model]);
  useEffect(() => { setEffortOverride(undefined); }, [session, details?.effort]);
  const model = modelOverride ?? details?.model ?? 'default';
  const effort = effortOverride ?? details?.effort ?? 'default';
  const live = LIVE.has(details?.state ?? '');
  const grow = () => {
    const el = area.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }
  };
  const call = async (method: string, body: Record<string, unknown>) => {
    setError(undefined);
    const res = await transport.request(method, { session, ...body }).catch((e: Error) => ({ type: 'err' as const, code: 'transport', message: e.message }));
    if (res.type === 'err') setError(res.code === 'agent.unsupported' ? `${details?.vendor ?? 'agent'} can't change ${res.message} here` : res.message);
    return res.type !== 'err';
  };
  const send = async () => {
    const t = text.trim(); if (!t) return;
    const images = img.wire.length ? img.wire : undefined;
    setText(''); img.clear(); requestAnimationFrame(grow);
    if (live && await call('session.steer', { text: t, images })) return;
    await call('session.prompt', { text: t, images });
  };
  const modes = details?.modes ?? [];
  const mode = details?.mode;
  return (
    <div style={{ padding: '0 var(--space-5) var(--space-4)', display: 'flex', justifyContent: 'center' }}>
      <div style={{
        width: '100%', maxWidth: 680, background: 'var(--bg-card)', border: '1px solid var(--line-card)',
        borderRadius: 12, padding: '10px 12px 8px', boxSizing: 'border-box', minWidth: 0,
      }} className="ormi-composer">
        {img.picker}
        <ImageStrip images={img.images} onRemove={img.remove} />
        <textarea
          ref={area}
          value={text}
          onChange={e => { setText(e.target.value); grow(); }}
          onPaste={img.onPaste}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={live ? 'Steer the agent…' : 'Reply…'} aria-label="prompt" rows={1}
          style={{
            width: '100%', resize: 'none', font: 'inherit', fontSize: 13, lineHeight: 1.5,
            color: 'var(--text-active)', background: 'transparent', border: 'none', outline: 'none',
            padding: '4px 0 6px', maxHeight: 168, overflow: 'hidden',
          }}
        />
        {error || img.error ? <div style={{ color: 'var(--accent-red)', fontSize: 11, marginBottom: 4 }}>{error ?? img.error}</div> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="hv-sub" style={{ ...iconBtn, flexShrink: 0 }} title="attach images" aria-label="attach images" onClick={img.pick}><Plus size={16} /></button>
          <button className="ormi-narrow-hide" style={{ ...iconBtn, opacity: 0.45, cursor: 'default' }} title="mention files (soon)" disabled><AtSign size={15} /></button>
          <button className="ormi-narrow-hide" style={{ ...iconBtn, opacity: 0.45, cursor: 'default' }} title="voice (soon)" disabled><Mic size={15} /></button>
          <span style={{ flex: 1, minWidth: 4 }} />
          {details?.branch ? (
            <button
              className="ormi-narrow-hide hv-sub"
              onClick={onGit}
              title={`${details.branch} · ${details.worktree ? 'worktree' : 'main checkout'}`}
              aria-label={`Git branch ${details.branch}${details.worktree ? ', worktree' : ', main checkout'}`}
              style={{
                ...chip, maxWidth: 140, minWidth: 0, flexShrink: 1,
                fontFamily: 'var(--font-mono)', fontSize: 11, cursor: onGit ? 'pointer' : 'default',
              }}
            >
              <GitBranch size={12} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{details.branch}</span>
              {details.worktree ? <span style={{ color: 'var(--text-hint)', fontSize: 9, flexShrink: 0 }}>wt</span> : null}
            </button>
          ) : null}
          {details?.vendor ? <span className="ormi-narrow-hide" style={{ ...chip, cursor: 'default', flexShrink: 0 }} title="agent · transport">{details.vendor}<span style={{ color: 'var(--text-hint)' }}>{details.transport}</span></span> : null}
          {modes.length ? <MenuChip title="mode" label="Mode" value={mode ?? modes[0]!.id} choices={modes.map(m => ({ value: m.id, name: m.name }))} onChange={v => void call('session.setMode', { mode: v })} /> : null}
          {details ? <ModelChip title="model — the vendor's model id" icon={<Cpu size={11} style={{ color: 'var(--text-hint)' }} />} value={model} models={modelList.models} loading={modelList.loading} refresh={modelList.refresh} onChange={v => { setModelOverride(v); if (v !== 'default') void call('session.setModel', { model: v }).then(ok => { if (!ok) setModelOverride(undefined); }); }} /> : null}
          {details ? <EffortChip title="effort — the vendor's own word" icon={<Gauge size={11} style={{ color: 'var(--text-hint)' }} />} value={effort} model={model} models={modelList.models} onChange={v => { setEffortOverride(v); if (v !== 'default') void call('session.setEffort', { effort: v }).then(ok => { if (!ok) setEffortOverride(undefined); }); }} /> : null}
          {live && !text.trim() ? (
            <button onClick={() => void call('session.abort', {})} title="stop the turn" aria-label="stop" style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2, flexShrink: 0,
              background: 'var(--text-active)', color: 'var(--text-onAccent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><Square size={10} fill="currentColor" /></button>
          ) : (
            <button onClick={() => void send()} title={live ? 'steer' : 'send'} aria-label="send" style={{
              width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer', marginLeft: 2, flexShrink: 0,
              background: 'var(--text-active)', color: 'var(--text-onAccent)', opacity: text.trim() ? 1 : 0.5,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><ArrowUp size={15} strokeWidth={2.5} /></button>
          )}
        </div>
      </div>
    </div>
  );
}
