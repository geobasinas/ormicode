/** @param {Uint8Array | Uint8ClampedArray} arr */
export function isPixelData(arr) {
    // work around instanceof Uint8Array not working properly in some Jest environments
    return ArrayBuffer.isView(arr) && arr.BYTES_PER_ELEMENT === 1;
}

/**
 * Check if a pixel is likely a part of anti-aliasing, by looking for an intensity
 * slope across its 8 neighbours (dark on one side, bright on the other).
 * @param {Uint8Array | Uint8ClampedArray} img
 * @param {number} x1
 * @param {number} y1
 * @param {number} width
 * @param {number} height
 * @param {Uint32Array} a32
 * @param {Uint32Array} b32
 */
export function antialiased(img, x1, y1, width, height, a32, b32) {
    const x0 = x1 > 0 ? x1 - 1 : 0;
    const y0 = y1 > 0 ? y1 - 1 : 0;
    const x2 = x1 < width - 1 ? x1 + 1 : width - 1;
    const y2 = y1 < height - 1 ? y1 + 1 : height - 1;
    const pos4 = (y1 * width + x1) * 4;
    // cache the center pixel's RGBA once instead of re-reading it on every neighbor comparison
    const cr = img[pos4];
    const cg = img[pos4 + 1];
    const cb = img[pos4 + 2];
    const ca = img[pos4 + 3];
    let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
    let min = 0;
    let max = 0;
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;

    // go through 8 adjacent pixels
    const rowStep = width * 4;
    for (let x = x0; x <= x2; x++) {
        let m = (y0 * width + x) * 4;
        for (let y = y0; y <= y2; y++, m += rowStep) {
            if (x === x1 && y === y1) continue;

            // brightness delta between the center pixel and adjacent one
            const delta = brightnessDelta(img, m, cr, cg, cb, ca);

            // count the number of equal, darker and brighter adjacent pixels
            if (delta === 0) {
                zeroes++;
                // if found more than 2 equal siblings, it's definitely not anti-aliasing
                if (zeroes > 2) return false;

            // remember the darkest pixel
            } else if (delta < min) {
                min = delta;
                minX = x;
                minY = y;

            // remember the brightest pixel
            } else if (delta > max) {
                max = delta;
                maxX = x;
                maxY = y;
            }
        }
    }

    // if there are no both darker and brighter pixels among siblings, it's not anti-aliasing
    if (min === 0 || max === 0) return false;

    // if either the darkest or the brightest pixel has 3+ equal siblings in both images
    // (definitely not anti-aliased), this pixel is anti-aliased
    return (hasManySiblings(a32, minX, minY, width, height) && hasManySiblings(b32, minX, minY, width, height)) ||
           (hasManySiblings(a32, maxX, maxY, width, height) && hasManySiblings(b32, maxX, maxY, width, height));
}

/**
 * Check if a pixel has 3+ adjacent pixels of the same color.
 * @param {Uint32Array} img
 * @param {number} x1
 * @param {number} y1
 * @param {number} width
 * @param {number} height
 */
function hasManySiblings(img, x1, y1, width, height) {
    const pos1 = y1 * width + x1;
    const val = img[pos1];

    if (x1 > 0 && x1 < width - 1 && y1 > 0 && y1 < height - 1) {
        return +(val === img[pos1 - width - 1]) +
               +(val === img[pos1 - 1]) +
               +(val === img[pos1 + width - 1]) +
               +(val === img[pos1 - width]) +
               +(val === img[pos1 + width]) +
               +(val === img[pos1 - width + 1]) +
               +(val === img[pos1 + 1]) +
               +(val === img[pos1 + width + 1]) > 2;
    }

    const x0 = x1 > 0 ? x1 - 1 : 0;
    const y0 = y1 > 0 ? y1 - 1 : 0;
    const x2 = x1 < width - 1 ? x1 + 1 : width - 1;
    const y2 = y1 < height - 1 ? y1 + 1 : height - 1;
    let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;

    // go through 8 adjacent pixels
    for (let x = x0; x <= x2; x++) {
        let pos = y0 * width + x;
        for (let y = y0; y <= y2; y++, pos += width) {
            if (x === x1 && y === y1) continue;
            zeroes += +(val === img[pos]);
            if (zeroes > 2) return true;
        }
    }
    return false;
}

// sRGB [0..255] -> linear [0..1] lookup table (padded with a 257th entry for interpolation)
export function brightnessDelta(img, m, r1, g1, b1, a1) {
    const r2 = img[m];
    const g2 = img[m + 1];
    const b2 = img[m + 2];
    const a2 = img[m + 3];

    let dr = r1 - r2;
    let dg = g1 - g2;
    let db = b1 - b2;
    const da = a1 - a2;

    if (!dr && !dg && !db && !da) return 0;

    if (a1 < 255 || a2 < 255) {
        dr = (r1 * a1 - r2 * a2 - 255 * da) / 255;
        dg = (g1 * a1 - g2 * a2 - 255 * da) / 255;
        db = (b1 * a1 - b2 * a2 - 255 * da) / 255;
        const d = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
        return d === 0 && da ? da / 2 : d;
    }

    return dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
}

