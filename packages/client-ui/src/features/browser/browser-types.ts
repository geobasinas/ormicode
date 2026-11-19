export type BrowserServiceState = 'stopped' | 'starting' | 'running' | 'unhealthy' | 'exited';
export type DevicePreset = 'Responsive' | 'Phone' | 'Tablet' | 'Desktop';

export type Portal = { title: string; path: string; url: string };
export type BrowserService = {
  name: string;
  state: BrowserServiceState;
  port: number;
  detail?: string;
  portals: Portal[];
};
export type BrowserPage = { id: string; title: string; port: number; path: string; url: string };
export type BrowserListed = {
  config: { found: boolean; path?: string; error?: string };
  services: BrowserService[];
  detected: { port: number; url: string }[];
  ports: { base: number; count: number };
};

export const SERVICES_YAML = `services:
  web:
    command: pnpm dev --port "$PORT"
    port: 0
    portals: [{ url: /, title: Home }]
`;
