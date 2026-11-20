import { sanitizeLayerMarkup } from './sanitize.ts';
import { INSPECTOR_LAYER_EXPORT_LIMIT } from './inspector-bridge-script.ts';

const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

export function buildDesignLayerDocument(html: string): string | undefined {
  if (!html || new TextEncoder().encode(html).length > INSPECTOR_LAYER_EXPORT_LIMIT) return undefined;
  const layer = sanitizeLayerMarkup(html);
  if (!layer.trim()) return undefined;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design layer</title><style>body{margin:0}</style></head><body>${layer}</body></html>`;
}

export function downloadDesignLayer(html: string, label: string): boolean {
  const result = buildDesignLayerDocument(html);
  if (!result) return false;
  const url = URL.createObjectURL(new Blob([result], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'design-layer') + '.html';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
