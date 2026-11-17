/** Pending approvals surface — can move/collapse via layout but is
 * never hidden; every answer goes through session.decide/session.answer. */
import { usePlatform } from '../../lib/platform.ts';
import { Button } from '../../components/Button.tsx';
import type { TranscriptEvent } from './useTranscript.ts';

export function Approvals({ session, pending }: { session: string; pending: TranscriptEvent[] }) {
  const { transport } = usePlatform();
  if (!pending.length) return null;
  return (
    <div style={{ borderTop: '1px solid var(--line-card)', padding: 'var(--space-3)', background: 'var(--bg-card)' }}>
      {pending.map(p => {
        const options = (p.body.options as { id: string; label: string }[]) ?? [];
        return (
          <div key={String(p.body.request)} style={{ marginBottom: 'var(--space-2)' }}>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-label)', marginBottom: 6 }}>
              {p.body.kind === 'question_request' ? 'question' : 'approval'}
              {Boolean(p.body.destructive) ? ' · DESTRUCTIVE' : ''}{p.body.rule ? ` · ${String(p.body.rule)}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {options.map((o, i) => (
                <Button key={o.id} variant={i === 0 ? 'primary' : 'ghost'} onClick={() =>
                  void transport.request('session.decide', { session, request: p.body.request, option: o.id })}>
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
