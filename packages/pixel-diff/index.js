import { antialiased, brightnessDelta, isPixelData } from "./antialias.js";
import { colorDelta } from "./color.js";

/**
 * Compare two equally sized images, pixel by pixel.
 *
 * @param {Uint8Array | Uint8ClampedArray} img1 First image data.
 * @param {Uint8Array | Uint8ClampedArray} img2 Second image data.
 * @param {Uint8Array | Uint8ClampedArray | null | undefined} output Image data to write the diff to, if provided.
 * @param {number} width Input images width.
 * @param {number} height Input images height.
 *
 * @param {Object} [options]
 * @param {number} [options.threshold=0.1] Matching threshold (0 to 1), the maximum OKLab HyAB distance (1 is black vs white) for pixels to be considered equal; smaller is more sensitive.
 * @param {boolean} [options.includeAA=false] Whether to count anti-aliased pixels as differences instead of detecting and ignoring them.
 * @param {number} [options.alpha=0.1] Opacity of original image in diff output.
 * @param {[number, number, number]} [options.aaColor=[255, 255, 0]] Color of anti-aliased pixels in diff output.
 * @param {[number, number, number]} [options.diffColor=[255, 0, 0]] Color of different pixels in diff output.
 * @param {[number, number, number]} [options.diffColorAlt=options.diffColor] Color of differing pixels that are darker in img2 than in img1, to distinguish "added" from "removed" parts.
 * @param {boolean} [options.diffMask=false] Draw the diff over a transparent background (a mask).
 * @param {boolean} [options.checkerboard=true] Whether to blend semi-transparent pixels against a checkerboard pattern (true) or plain white (false) when comparing.
 * @param {number} [options.windowSize=Infinity] If finite, return the maximum number of diff pixels found in any N×N sliding window instead of the total diff count.
 * @param {Uint8Array | Uint8ClampedArray} [options.ignoreMask] One byte per pixel (width × height); pixels with a non-zero value are skipped from comparison.
 *
 * @return {number} The number of mismatched pixels (or the maximum per-window count if windowSize is finite).
 */
export default function pixelDiff(img1, img2, output, width, height, options = {}) {
    const {
        threshold = 0.1,
        alpha = 0.1,
        aaColor = [255, 255, 0],
        diffColor = [255, 0, 0],
        checkerboard = true,
        windowSize = Infinity,
        includeAA, diffColorAlt, diffMask,
        ignoreMask
    } = options;

    if (!isPixelData(img1) || !isPixelData(img2) || (output && !isPixelData(output)) ||
        (ignoreMask && !isPixelData(ignoreMask)))
        throw new Error('Image data: Uint8Array, Uint8ClampedArray or Buffer expected.');

    if (img1.length !== img2.length || (output && output.length !== img1.length))
        throw new Error(`Image sizes do not match. Image 1 size: ${img1.length}, image 2 size: ${img2.length}`);

    const len = width * height;

    if (img1.length !== len * 4) throw new Error(`Image data size does not match width/height. Expecting ${len * 4}. Got ${img1.length}`);

    if (ignoreMask && ignoreMask.length !== len)
        throw new Error(`Ignore mask size does not match image width/height. Expecting ${len}. Got ${ignoreMask.length}`);

    // check if images are identical
    const a32 = new Uint32Array(img1.buffer, img1.byteOffset, len);
    const b32 = new Uint32Array(img2.buffer, img2.byteOffset, len);

    let identical = true;

    for (let i = 0; i < len; i++) {
        if (a32[i] !== b32[i] && (!ignoreMask || !ignoreMask[i])) { identical = false; break; }
    }
    if (identical) { // fast path if identical
        if (output && !diffMask) {
            for (let i = 0, pos = 0; i < len; i++, pos += 4) drawGrayPixel(output, pos, img1, alpha);
        }
        return 0;
    }

    const [aaR, aaG, aaB] = aaColor;
    const [diffR, diffG, diffB] = diffColor;
    const [altR, altG, altB] = diffColorAlt || diffColor;
    let diff = 0;

    // per-pixel diff mask, only allocated when windowSize is finite (keeps the
    // default path allocation-free): 0 same/ignored, 1 diff, 2 excluded AA.
    // diff pixels are given odd values so the window scan can count them
    // branchlessly with `& 1`.
    const mask = Number.isFinite(windowSize) ? new Uint8Array(len) : null;
    // first/last row containing a counted diff, to bound the windowed post-pass
    let firstDiffY = -1;
    let lastDiffY = 0;

    // compare each pixel of one image against the other one
    for (let i = 0, pos = 0; i < len; i++, pos += 4) {
        // whether the HyAB OKLab distance exceeds the threshold: 0 if not, ±1 if yes (negative if img2 pixel is darker)
        const delta = (a32[i] === b32[i] || (ignoreMask && ignoreMask[i])) ? 0 : colorDelta(img1, img2, pos, checkerboard, threshold);

        // the color difference is above the threshold
        if (delta) {
            const x = i % width;
            const y = (i / width) | 0;
            // check it's a real rendering difference or just anti-aliasing
            const isExcludedAA = !includeAA && (antialiased(img1, x, y, width, height, a32, b32) || antialiased(img2, x, y, width, height, b32, a32));
            if (isExcludedAA) {
                // one of the pixels is anti-aliasing; draw as yellow and do not count as difference
                // note that we do not include such pixels in a mask
                if (output && !diffMask) drawPixel(output, pos, aaR, aaG, aaB);
                if (mask) mask[i] = 2;

            } else {
                // found substantial difference not caused by anti-aliasing; draw it as such
                if (output) {
                    if (delta < 0) {
                        drawPixel(output, pos, altR, altG, altB);
                    } else {
                        drawPixel(output, pos, diffR, diffG, diffB);
                    }
                }
                if (mask) {
                    mask[i] = 1;
                    if (firstDiffY < 0) firstDiffY = y;
                    lastDiffY = y;
                }
                diff++;
            }

        } else if (output && !diffMask) {
            // pixels are similar; draw background as grayscale image blended with white
            drawGrayPixel(output, pos, img1, alpha);
        }
    }

    // return the number of different pixels (no windowed post-pass needed if there are none)
    if (!mask || !diff) return diff;

    // windowed mode: return the maximum number of diff pixels (state 1) over all N×N sliding
    // windows, N floored and clamped to [1, min(width, height)]
    const n = Math.min(Math.max(Math.floor(windowSize), 1), width, height);

    // colSum[x] counts diff pixels in column x over the last n rows; maintained incrementally (add
    // entering row, subtract leaving row), which is why the full mask has to be kept around. diff
    // pixels are odd (`& 1`), AA/same even.
    const colSum = new Uint16Array(width);
    let maxCount = 0;
    // running total of all column sums = diff pixels in the current n-row band;
    // an upper bound for any single window, so bands that can't beat maxCount skip
    // the horizontal scan entirely (most bands are sparse or empty)
    let bandTotal = 0;

    // only rows in [firstDiffY, lastDiffY] hold diffs, so colSum is zero before the
    // first and drained after a leaving row passes the last — bound the scan to the
    // bands that can be nonzero (rows before firstDiffY stay empty, so starting there
    // keeps colSum correct without special initialization)
    const yEnd = Math.min(height - 1, lastDiffY + n - 1);

    for (let y = firstDiffY; y <= yEnd; y++) {
        const rowStart = y * width;
        const leaving = y - n;
        // update column sums: add the entering row, subtract the leaving row
        // (both in one pass over the width)
        if (leaving >= 0) {
            const leavingStart = leaving * width;
            for (let x = 0; x < width; x++) {
                const d = (mask[rowStart + x] & 1) - (mask[leavingStart + x] & 1);
                colSum[x] += d;
                bandTotal += d;
            }
        } else {
            for (let x = 0; x < width; x++) {
                const e = mask[rowStart + x] & 1;
                colSum[x] += e;
                bandTotal += e;
            }
            // only scan windows that are fully inside vertically
            if (y < n - 1) continue;
        }

        // no window in this band can exceed the total diff count it contains
        if (bandTotal <= maxCount) continue;

        // horizontal running sum over colSum yields every window sum in this band;
        // prime the first n-1 columns, then slide with no per-iteration bounds checks
        let windowSum = 0;
        for (let x = 0; x < n - 1; x++) windowSum += colSum[x];
        for (let x = n - 1; x < width; x++) {
            windowSum += colSum[x];
            if (windowSum > maxCount) maxCount = windowSum;
            windowSum -= colSum[x - n + 1];
        }
    }

    return maxCount;
}

/**
 * @param {Uint8Array | Uint8ClampedArray} output
 * @param {number} pos
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
function drawPixel(output, pos, r, g, b) {
    output[pos] = r;
    output[pos + 1] = g;
    output[pos + 2] = b;
    output[pos + 3] = 255;
}

/**
 * @param {Uint8Array | Uint8ClampedArray} output
 * @param {number} i
 * @param {Uint8Array | Uint8ClampedArray} img
 * @param {number} alpha
 */
function drawGrayPixel(output, i, img, alpha) {
    const val = 255 + (img[i] * 0.29889531 + img[i + 1] * 0.58662247 + img[i + 2] * 0.11448223 - 255) * alpha * img[i + 3] / 255;
    drawPixel(output, i, val, val, val);
}
