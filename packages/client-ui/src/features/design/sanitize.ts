import createDOMPurify from 'dompurify';

const DOMPurify = createDOMPurify(window);

export const SANITIZE_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'select', 'textarea', 'a', 'area', 'base', 'meta', 'link', 'video', 'audio', 'source'],
  FORBID_ATTR: ['srcdoc', 'srcset', 'action', 'formaction', 'target', 'download', 'ping', 'autofocus'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i,
};

export function sanitizeMarkup(input: string): string {
  return DOMPurify.sanitize(input, SANITIZE_CONFIG);
}
