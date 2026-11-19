import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronLeft, ChevronRight, Eraser, ExternalLink, Globe, LockKeyhole, Monitor,
  MoreHorizontal, MousePointerSquareDashed, PenLine, Play, Plus, RotateCw, Server, Smartphone, Square, Tablet, ScrollText, TerminalSquare, X,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import type { BrowserListed, BrowserPage, BrowserService, DevicePreset } from './browser-types.ts';
import { BrowserIconButton, ServiceStatusDot } from './browser-ui.tsx';

type Props = {
  pages: BrowserPage[]; active: number; listed?: BrowserListed; current?: BrowserPage;
  canBack: boolean; canForward: boolean; loading: boolean; address: string; history: string[];
  pickActive: boolean; consoleUnread: number;
  device: DevicePreset; fixed: boolean; busyService: string; actionError: string; keepSignins: boolean;
  onSelectPage: (index: number) => void; onClosePage: (index: number) => void;
  onOpenPortal: (port: number, path: string, title: string) => void;
  onBack: () => void; onForward: () => void; onReload: () => void;
  onPick: () => void; onAnnotate: () => void; onConsole: () => void;
  onAddressChange: (value: string) => void; onAddressSubmit: () => void;
  onDeviceChange: (device: DevicePreset) => void; onRotate: () => void;
  onRefresh: () => void; onServiceAction: (action: 'service.start' | 'service.stop' | 'service.restart', service: string) => void;
  onLogs: (service: string) => void; onOpenExternal: () => void;
  onKeepSigninsChange: (value: boolean) => void; onClearBrowsingData: () => void;
  onOverlayOpenChange: (open: boolean) => void;
};

const toolbarButton = { height: 26, display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, border: 0, borderRadius: 6, padding: '0 6px', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' } as const;
const portalTitle = (service: BrowserService, title: string) => `${service.name} · ${title}`;

export function BrowserControls(props: Props) {
  const [servicesOpen, setServicesOpen] = useState(false);
  const [portalsOpen, setPortalsOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const overlayOpen = servicesOpen || portalsOpen || deviceOpen || moreOpen;
  useEffect(() => props.onOverlayOpenChange(overlayOpen), [overlayOpen, props.onOverlayOpenChange]);
  const services = props.listed?.services ?? [];
  const detected = props.listed?.detected ?? [];
  const options = services.flatMap(service => service.portals.map(portal => ({ service, portal })));
  const DeviceIcon = props.device === 'Phone' ? Smartphone : props.device === 'Tablet' ? Tablet : Monitor;

  return <div style={{ position: 'relative', zIndex: 20, flexShrink: 0, background: 'var(--bg-main)' }}>
    <div className="ormi-tabs" role="tablist" aria-label="Browser tabs" style={{
      height: 38, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
      borderBottom: '1px solid var(--line-subtle)', overflow: 'hidden',
    }}>
      <div style={{ minWidth: 0, flex: 1, height: '100%', display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
        {props.pages.map((page, index) => {
          const selected = index === props.active;
          return <div key={page.id} role="presentation" className="ormi-browser-tab" data-active={selected} style={{
            maxWidth: 170, minWidth: 0, height: 32, marginTop: 5, flexShrink: 0, display: 'flex', alignItems: 'center',
            borderRadius: '6px 6px 0 0', background: selected ? 'var(--bg-main)' : 'transparent',
          }}>
            <button type="button" role="tab" aria-selected={selected} onClick={() => props.onSelectPage(index)} className={selected ? undefined : 'hv-tab'}
              style={{ height: '100%', minWidth: 0, display: 'flex', alignItems: 'center', padding: '0 5px 0 9px', border: 0, borderRadius: '6px 0 0 0', background: 'transparent', color: selected ? 'var(--text-active)' : 'var(--text-secondary)', fontSize: 11.5, fontWeight: selected ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.title}</span>
            </button>
            <button type="button" aria-label={`Close ${page.title}`} title={`Close ${page.title}`} className="ormi-browser-tab-close hv-x"
              onClick={() => props.onClosePage(index)} style={{ width: 22, height: 22, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 5, background: 'transparent', color: selected ? 'var(--text-secondary)' : 'var(--text-hint)', opacity: selected ? 1 : 0, cursor: 'pointer' }}>
              <X size={12} />
            </button>
          </div>;
        })}
      </div>
      <DropdownMenu open={portalsOpen} onOpenChange={setPortalsOpen}>
        <DropdownMenuTrigger asChild><BrowserIconButton title="Open a portal"><Plus size={14} /></BrowserIconButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end" style={{ minWidth: 190 }}>
          <DropdownMenuLabel>Open preview</DropdownMenuLabel>
          {options.map(({ service, portal }) => <DropdownMenuItem key={`${service.name}:${portal.path}`} onSelect={() => props.onOpenPortal(service.port, portal.path, portal.title)}>
            <Globe size={13} />{portalTitle(service, portal.title)}
          </DropdownMenuItem>)}
          {detected.length ? <><DropdownMenuSeparator /><DropdownMenuLabel>Detected</DropdownMenuLabel>
            {detected.map(item => <DropdownMenuItem key={item.port} onSelect={() => props.onOpenPortal(item.port, '/', `Port ${item.port}`)}>
              <ExternalLink size={13} />:{item.port}
            </DropdownMenuItem>)}</> : null}
          {!options.length && !detected.length ? <DropdownMenuItem disabled>No portals available</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', borderBottom: '1px solid var(--line-subtle)' }}>
      <BrowserIconButton title="Back" disabled={!props.canBack} onClick={props.onBack}><ChevronLeft size={15} /></BrowserIconButton>
      <BrowserIconButton title="Forward" disabled={!props.canForward} onClick={props.onForward}><ChevronRight size={15} /></BrowserIconButton>
      <BrowserIconButton title="Reload" disabled={!props.current} onClick={props.onReload}><RotateCw size={13} /></BrowserIconButton>
      <div style={{ minWidth: 120, flex: 1, height: 28, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', border: '1px solid var(--line-divider)', borderRadius: 8, background: 'var(--bg-card)' }}>
        <LockKeyhole size={12} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
        <input aria-label="Preview path" list={`browser-history-${props.current?.port ?? 'none'}`} value={props.address}
          onChange={event => props.onAddressChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') props.onAddressSubmit(); }}
          placeholder="Enter path" style={{ width: '100%', minWidth: 0, border: 0, outline: 0, background: 'transparent', color: 'var(--text-label)', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        <datalist id={`browser-history-${props.current?.port ?? 'none'}`}>{props.history.map(path => <option key={path} value={path} />)}</datalist>
      </div>
      <BrowserIconButton title={props.pickActive ? 'Cancel picking' : 'Pick element (Ctrl+Shift+C)'} aria-pressed={props.pickActive} onClick={props.onPick}
        style={props.pickActive ? { background: 'var(--bg-selected)', color: 'var(--text-active)' } : undefined}><MousePointerSquareDashed size={14} /></BrowserIconButton>
      <BrowserIconButton title="Annotate preview" onClick={props.onAnnotate}><PenLine size={14} /></BrowserIconButton>
      <button type="button" title="Preview console" aria-label="Preview console" onClick={props.onConsole} className="hv ormi-browser-console-toggle" style={{ ...toolbarButton, padding: '0 5px', position: 'relative' }}>
        <TerminalSquare size={14} /><span className="ormi-browser-wide-label">Console</span>
        {props.consoleUnread ? <span style={{ minWidth: 14, height: 14, display: 'inline-grid', placeItems: 'center', padding: '0 3px', borderRadius: 8, background: 'var(--accent-red)', color: 'var(--text-onAccent)', fontSize: 9 }}>{props.consoleUnread > 99 ? '99+' : props.consoleUnread}</span> : null}
      </button>
      <DropdownMenu open={deviceOpen} onOpenChange={setDeviceOpen}>
        <DropdownMenuTrigger asChild><button type="button" title="Device preset" aria-label="Device preset" className="hv" style={toolbarButton}>
          <DeviceIcon size={14} /><span className="ormi-pane-narrow-hide">{props.device}</span><ChevronDown size={11} className="ormi-pane-narrow-hide" />
        </button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Device size</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={props.device} onValueChange={value => props.onDeviceChange(value as DevicePreset)}>
            <DropdownMenuRadioItem value="Responsive"><Monitor size={13} />Responsive</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Phone"><Smartphone size={13} />Phone · 390 × 844</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Tablet"><Tablet size={13} />Tablet · 820 × 1180</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="Desktop"><Monitor size={13} />Desktop · 1440 × 900</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {props.fixed ? <BrowserIconButton title="Rotate device" onClick={props.onRotate}><RotateCw size={13} /></BrowserIconButton> : null}
      <Popover open={servicesOpen} onOpenChange={open => { setServicesOpen(open); if (open) props.onRefresh(); }}>
        <PopoverTrigger asChild><button type="button" aria-label="Services" title="Services" className="hv" style={{
          ...toolbarButton, gap: 6, padding: '0 8px', border: '1px solid var(--line-card)', background: 'var(--bg-chip)', color: 'var(--text-label)',
        }}>
          <ServiceStatusDot state={services.some(service => service.state === 'exited') ? 'exited'
            : services.some(service => service.state === 'unhealthy') ? 'unhealthy'
              : services.some(service => service.state === 'starting') ? 'starting'
                : services.some(service => service.state === 'running') ? 'running' : 'stopped'} />
          <Server size={13} className="ormi-browser-service-icon" />
          <span className="ormi-browser-wide-label">Services</span><ChevronDown size={11} className="ormi-browser-wide-label" />
        </button></PopoverTrigger>
        <PopoverContent align="end" side="bottom" sideOffset={5} style={{
          width: 'min(320px, calc(100vw - 32px))', maxHeight: 'min(62vh, 420px)', overflowY: 'auto',
          padding: 8, border: '1px solid var(--line-card)', borderRadius: 9, background: 'var(--bg-raised)',
          color: 'var(--text-label)', boxShadow: '0 12px 36px var(--shadow-color)',
        }}>
          <div style={{ padding: '3px 4px 8px', fontSize: 12, fontWeight: 600 }}>Services</div>
          {props.listed?.config.error ? <div role="alert" style={{ margin: '0 0 8px', padding: '7px 8px', border: '1px solid var(--line-red)', borderRadius: 7, background: 'var(--tint-red)', color: 'var(--accent-red)', fontSize: 11 }}>{props.listed.config.error}</div> : null}
          {services.map(service => {
            const canStop = ['starting', 'running', 'unhealthy'].includes(service.state);
            const busy = props.busyService === service.name;
            return <div key={service.name} style={{ padding: '7px 3px', borderTop: '1px solid var(--line-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ServiceStatusDot state={service.state} />
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-active)' }}>{service.name}</span>
                <span style={{ color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>:{service.port}</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: service.state === 'running' ? 'var(--accent-mint)' : service.state === 'exited' ? 'var(--accent-red)' : ['starting', 'unhealthy'].includes(service.state) ? 'var(--accent-amber)' : 'var(--text-hint)', fontSize: 10.5 }}>{service.state}</span>
                <BrowserIconButton title={canStop ? `Stop ${service.name}` : `Start ${service.name}`} disabled={busy} onClick={() => props.onServiceAction(canStop ? 'service.stop' : 'service.start', service.name)}>
                  {canStop ? <Square size={12} /> : <Play size={12} />}
                </BrowserIconButton>
                <BrowserIconButton title={`Restart ${service.name}`} disabled={busy} onClick={() => props.onServiceAction('service.restart', service.name)}><RotateCw size={12} /></BrowserIconButton>
                <BrowserIconButton title={`View ${service.name} logs`} onClick={() => props.onLogs(service.name)}><ScrollText size={13} /></BrowserIconButton>
              </div>
              {service.portals.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '5px 0 0 13px' }}>
                {service.portals.map(portal => <button key={portal.path} type="button" className="hv" onClick={() => props.onOpenPortal(service.port, portal.path, portal.title)}
                  style={{ padding: '3px 6px', border: '1px solid var(--line-subtle)', borderRadius: 6, background: 'transparent', color: 'var(--text-label)', fontSize: 10.5, cursor: 'pointer' }}>{portal.title}</button>)}
              </div> : null}
            </div>;
          })}
          {!services.length ? <div style={{ padding: '8px 4px', color: 'var(--text-hint)', fontSize: 11 }}>No services in .ormi/services.yaml</div> : null}
          {detected.length ? <div style={{ paddingTop: 6, borderTop: '1px solid var(--line-subtle)' }}>
            <div style={{ padding: '3px 4px 6px', color: 'var(--text-hint)', fontSize: 9.5, fontWeight: 600, letterSpacing: 0.7 }}>DETECTED</div>
            {detected.map(item => <div key={item.port} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 3px' }}>
              <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>:{item.port}</span>
              <button type="button" className="hv" onClick={() => props.onOpenPortal(item.port, '/', `Port ${item.port}`)}
                style={{ padding: '3px 7px', border: '1px solid var(--line-card)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-label)', fontSize: 10.5, cursor: 'pointer' }}>Open</button>
            </div>)}
          </div> : null}
          {props.actionError ? <div role="alert" style={{ marginTop: 7, padding: '6px 8px', borderRadius: 6, background: 'var(--tint-red)', color: 'var(--accent-red)', fontSize: 10.5 }}>{props.actionError}</div> : null}
        </PopoverContent>
      </Popover>
      <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
        <DropdownMenuTrigger asChild><BrowserIconButton title="More preview options"><MoreHorizontal size={16} /></BrowserIconButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!props.current} onSelect={props.onOpenExternal}><ExternalLink size={13} />Open in browser</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked={props.keepSignins} onCheckedChange={value => props.onKeepSigninsChange(value === true)}>
            <LockKeyhole size={13} />Keep sign-ins
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={props.onClearBrowsingData}><Eraser size={13} />Clear browsing data…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div aria-hidden="true" style={{ height: 2, overflow: 'hidden', background: 'transparent' }}>
      {props.loading ? <div className="ormi-browser-progress" /> : null}
    </div>
  </div>;
}
