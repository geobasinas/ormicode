import type { ProtocolTransport } from '@ormicode/client-platform';

export async function fetchArtifact(transport: ProtocolTransport, session: string, id: string) {
  const pages: Uint8Array[] = [];
  let size = 0;
  let offset = 0;
  let mime = 'image/png';
  let more = true;
  while (more) {
    const response = await transport.request('browser.artifact', { session, id, offset, length: 512 * 1024 });
    if (response.type !== 'res') throw new Error('Could not load browser screenshot.');
    const page = response.body as { mime: string; data: string; size: number; offset: number; more?: boolean };
    const binary = atob(page.data);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    pages.push(bytes);
    size = page.size;
    mime = page.mime;
    offset += bytes.length;
    more = Boolean(page.more);
  }
  const bytes = new Uint8Array(offset);
  let cursor = 0;
  for (const page of pages) { bytes.set(page, cursor); cursor += page.length; }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { mime, data: btoa(binary), size };
}
