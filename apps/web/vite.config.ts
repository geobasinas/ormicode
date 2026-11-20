import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { BRIDGE_SCRIPT } from '../../packages/client-ui/src/features/design/bridge.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const relay = process.env.ORMI_RELAY_URL ?? 'https://relay.ormi.codes';
const commit = process.env.ORMI_COMMIT ?? execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

function securityHeaders(): Plugin {
  const relayUrl = new URL(relay);
  const relayHttp = relayUrl.origin;
  const relayWs = `${relayUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${relayUrl.host}`;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${createHash('sha256').update(BRIDGE_SCRIPT).digest('base64')}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${relayHttp} ${relayWs}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'ormicode-security-headers',
    transformIndexHtml(html) {
      return html.replace('__ORMI_CSP__', csp.replace("; frame-ancestors 'none'", ''));
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${csp}`,
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: no-referrer',
          '  Cache-Control: no-cache',
          '/assets/*',
          '  ! Cache-Control',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react(), tailwindcss(), securityHeaders()],
  define: {
    __ORMI_VERSION__: JSON.stringify(pkg.version),
    __ORMI_COMMIT__: JSON.stringify(commit),
    __ORMI_RELAY__: JSON.stringify(relay),
  },
  build: {
    assetsDir: 'assets',
    rollupOptions: { output: { assetFileNames: 'assets/[name]-[hash][extname]', chunkFileNames: 'assets/[name]-[hash].js', entryFileNames: 'assets/[name]-[hash].js' } },
  },
});
