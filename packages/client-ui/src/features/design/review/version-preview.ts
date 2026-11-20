import { sanitizeMarkup } from '../sanitize.ts';

export function versionPreviewSrcDoc(html: string, styles: string): string {
  const safeStyles = styles.replace(/</g, '\\3c ');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>${safeStyles}</style>${sanitizeMarkup(html)}`;
}
