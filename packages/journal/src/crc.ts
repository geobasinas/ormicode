/** Pure-JS CRC32C (Castagnoli), enough at journal-row sizes. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82F63B78 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32c(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let crc = 0xFFFFFFFF;
  for (const b of bytes) crc = TABLE[(crc ^ b) & 0xFF]! ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
