import { DESIGN_IMAGE_VALUE_LIMIT } from '@ormicode/protocol';

export const IMAGE_SOURCE_PATTERN = '^data:image/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$';
export const IMAGE_SOURCE_LIMIT = DESIGN_IMAGE_VALUE_LIMIT - 'url("")'.length;
export const DESIGN_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/avif';

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function embedDesignImage(file: File): Promise<string> {
  if (!DESIGN_IMAGE_TYPES.split(',').includes(file.type) || !file.size || file.size > 12 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG, GIF, WebP, or AVIF image up to 12 MB.');
  }
  if (file.size <= Math.floor((IMAGE_SOURCE_LIMIT - 30) * 3 / 4)) return dataUrl(file);
  if (file.type === 'image/gif') throw new Error('Use a GIF up to 6 KB to retain animation, or choose a still image.');
  const image = await createImageBitmap(file).catch(() => { throw new Error('The image could not be decoded.'); });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The image could not be resized.');
    for (const [edge, quality] of [[640, 0.72], [480, 0.65], [320, 0.55], [240, 0.48], [160, 0.45]]) {
      const scale = Math.min(1, edge / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const source = canvas.toDataURL('image/webp', quality);
      if (source.length <= IMAGE_SOURCE_LIMIT && new RegExp(IMAGE_SOURCE_PATTERN).test(source)) return source;
    }
    throw new Error('The image could not fit the board’s embedded image budget.');
  } finally { image.close(); }
}
