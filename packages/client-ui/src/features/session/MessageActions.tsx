import { useState } from 'react';
import { Copy, Pencil, RotateCw } from 'lucide-react';
import { usePlatform } from '../../lib/platform.ts';

const buttonStyle = { display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, borderRadius: 4, padding: '3px 5px', background: 'var(--bg-card)', color: 'var(--text-hint)', font: 'inherit', fontSize: 10, cursor: 'pointer' };

export function PromptActions({ session, text, checkpoint, onEdit }: { session: string; text: string; checkpoint?: string; onEdit?(text: string): void }) {
  const { transport } = usePlatform();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const rewind = async () => {
    if (!checkpoint) return;
    const result = await transport.request('checkpoint.restore', { session, id: checkpoint, mode: 'conversation' });
    if (result.type === 'err') { setError(result.message); return; }
    setConfirm(false);
    onEdit?.(text);
  };
  return <div className="ormi-hover-reveal" style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
    <button type="button" style={buttonStyle} onClick={() => void navigator.clipboard.writeText(text)}><Copy size={10} />Copy</button>
    {confirm ? <>
      <span style={{ color: 'var(--text-hint)', fontSize: 10, alignSelf: 'center' }}>Rewind files and conversation?</span>
      <button type="button" disabled={!checkpoint} style={buttonStyle} onClick={() => void rewind()}>Confirm</button>
      <button type="button" style={buttonStyle} onClick={() => { setConfirm(false); setError(''); }}>Cancel</button>
      {!checkpoint || error ? <span style={{ color: 'var(--accent-red)', fontSize: 10 }}>{error || 'No checkpoint before this prompt'}</span> : null}
    </> : <button type="button" style={buttonStyle} onClick={() => setConfirm(true)}><Pencil size={10} />Edit & resend</button>}
  </div>;
}

export function AgentActions({ session, text }: { session: string; text: string }) {
  const { transport } = usePlatform();
  const [status, setStatus] = useState('');
  const retry = async () => {
    const result = await transport.request('session.retry', { session });
    setStatus(result.type === 'err' ? result.message : 'Retrying');
  };
  return <div className="ormi-hover-reveal" style={{ display: 'flex', gap: 4, marginTop: 3 }}>
    <button type="button" style={buttonStyle} onClick={() => { void navigator.clipboard.writeText(text); setStatus('Copied'); }}><Copy size={10} />Copy Markdown</button>
    <button type="button" style={buttonStyle} onClick={() => void retry()}><RotateCw size={10} />Retry</button>
    {status ? <span style={{ alignSelf: 'center', color: 'var(--text-hint)', fontSize: 10 }}>{status}</span> : null}
  </div>;
}
