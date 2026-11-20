import { Copy, Globe, LoaderCircle, Play, RotateCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BrowserListed, BrowserService } from './browser-types.ts';
import type { BrowserLoadError } from './browser-load-error.ts';
import { SERVICES_YAML } from './browser-types.ts';
import { browserPrimaryButton } from './browser-ui.tsx';

function NoticeCard({ title, description, children, icon }: {
  title: string; description: string; children?: ReactNode; icon?: ReactNode;
}) {
  return <section style={{
    width: 'min(440px, calc(100% - 32px))', boxSizing: 'border-box', padding: 22,
    borderRadius: 12, border: '1px solid var(--line-card)', background: 'var(--bg-card)',
    color: 'var(--text-active)', boxShadow: '0 12px 32px var(--shadow-color)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ display: 'inline-flex', color: 'var(--text-secondary)' }}>{icon ?? <Globe size={18} />}</span>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h2>
    </div>
    <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>{description}</p>
    {children}
  </section>;
}

export function EmptyPreview({ listed }: { listed: BrowserListed }) {
  return <NoticeCard title="Browse the web or preview your app" description="Enter a URL or search above. For a local preview, add a service to this session and start it.">
    <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: 'var(--bg-inset)', border: '1px solid var(--line-card)' }}>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-label)', fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.5 }}>{SERVICES_YAML}</pre>
      <button type="button" className="hv" onClick={() => void navigator.clipboard.writeText(SERVICES_YAML)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '4px 7px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-raised)', color: 'var(--text-label)', fontSize: 11, cursor: 'pointer' }}>
        <Copy size={12} />Copy snippet
      </button>
    </div>
    <div style={{ marginTop: 12, color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
      Session ports {listed.ports.base}–{listed.ports.base + listed.ports.count - 1}
    </div>
  </NoticeCard>;
}

export function StoppedPreview({ service, onStart, starting = false }: {
  service: BrowserService; onStart: () => void; starting?: boolean;
}) {
  return <NoticeCard title={starting ? `${service.name} is starting` : `${service.name} is stopped`}
    description={starting ? 'The service is starting. The preview will open when it is ready.' : 'Start this service to open its preview.'}
    icon={starting ? <LoaderCircle size={18} className="animate-spin" /> : <Globe size={18} />}>
    {!starting ? <button type="button" onClick={onStart} style={{ ...browserPrimaryButton, marginTop: 16 }}>
      <Play size={13} />Start {service.name}
    </button> : null}
  </NoticeCard>;
}

export function LoadFailed({ error, onRetry }: { error: BrowserLoadError; onRetry: () => void }) {
  return <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-main)' }}>
    <NoticeCard title={error.title} description={error.description} icon={<TriangleAlert size={18} />}>
      <div style={{ marginTop: 10, color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10.5, overflowWrap: 'anywhere' }}>{error.target}</div>
      {error.kind !== 'invalid' ? <button type="button" onClick={onRetry} style={{ ...browserPrimaryButton, marginTop: 16 }}><RotateCw size={13} />Try again</button> : null}
    </NoticeCard>
  </div>;
}

export function RemotePreview() {
  return <NoticeCard title="Preview runs on the hub machine for now" description="Relay preview is not built yet." />;
}

export function ChoosePreview({ listed, onOpenPortal }: {
  listed: BrowserListed; onOpenPortal: (port: number, path: string, title: string) => void;
}) {
  return <NoticeCard title="Choose a preview" description="Open a service portal or a detected local port.">
    {listed.services.map(service => <div key={service.name} style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-label)' }}>{service.name} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-hint)' }}>:{service.port}</span></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
        {service.portals.map(portal => <button key={portal.path} type="button" className="hv" onClick={() => onOpenPortal(service.port, portal.path, portal.title)}
          style={{ padding: '4px 7px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-raised)', color: 'var(--text-label)', fontSize: 11, cursor: 'pointer' }}>{portal.title}</button>)}
      </div>
    </div>)}
    {listed.detected.length ? <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
      {listed.detected.map(item => <button key={item.port} type="button" className="hv" onClick={() => onOpenPortal(item.port, '/', `Port ${item.port}`)}
        style={{ padding: '4px 7px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-raised)', color: 'var(--text-label)', fontSize: 11, cursor: 'pointer' }}>Open :{item.port}</button>)}
    </div> : null}
  </NoticeCard>;
}
