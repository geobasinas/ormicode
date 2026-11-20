const LIN = new Float64Array(257);
for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
LIN[256] = LIN[255];

// premultiplied LMS matrix contributions for opaque sRGB byte values
const L_R = new Float64Array(256);
const L_G = new Float64Array(256);
const L_B = new Float64Array(256);
const M_R = new Float64Array(256);
const M_G = new Float64Array(256);
const M_B = new Float64Array(256);
const S_R = new Float64Array(256);
const S_G = new Float64Array(256);
const S_B = new Float64Array(256);
for (let i = 0; i < 256; i++) {
    const lr = LIN[i];
    L_R[i] = 0.4122214708 * lr;
    M_R[i] = 0.2119034982 * lr;
    S_R[i] = 0.0883024619 * lr;
    L_G[i] = 0.5363325363 * lr;
    M_G[i] = 0.6806995451 * lr;
    S_G[i] = 0.2817188376 * lr;
    L_B[i] = 0.0514459929 * lr;
    M_B[i] = 0.1073969566 * lr;
    S_B[i] = 0.6299787005 * lr;
}

// sRGB->linear for a fractional [0..255] channel value via linear interpolation of LIN
/** @param {number} x */
function linLUT(x) {
    const i = x | 0;
    return LIN[i] + (LIN[i + 1] - LIN[i]) * (x - i);
}

// cube root over [0..1] via lookup table with linear interpolation
const CBRT_N = 4096;
const CBRT = new Float64Array(CBRT_N + 2);
for (let i = 0; i <= CBRT_N + 1; i++) CBRT[i] = Math.cbrt(i / CBRT_N);
const CBRT_EXACT = 8;
/** @param {number} x */
function cbrtLUT(x) {
    const t = x * CBRT_N;
    const i = t | 0;
    // cbrt curves hardest right above zero, where linear interpolation between samples is off by
    // up to 50%; that lands on near-black pixels, whose differences it then wildly over-weights
    if (i < CBRT_EXACT) return Math.cbrt(x);
    return CBRT[i] + (CBRT[i + 1] - CBRT[i]) * (t - i);
}

// direct-mapped cache for opaque RGB -> cube-rooted LMS values and toe-corrected OKLab lightness
const OKLAB_CACHE_BITS = 12;
const OKLAB_CACHE_SHIFT = 32 - OKLAB_CACHE_BITS;
const OKLAB_CACHE_SIZE = 1 << OKLAB_CACHE_BITS;
const OKLAB_CACHE_KEYS = new Uint32Array(OKLAB_CACHE_SIZE);
const OKLAB_CACHE_VALUES = new Float64Array(OKLAB_CACHE_SIZE * 4);

const TOE_K1 = 0.206;
const TOE_K2 = 0.03;
const TOE_K3 = (1 + TOE_K1) / (1 + TOE_K2);

/**
 * Calculate the perceptual color difference between two pixels in the OKLab color space
 * with the HyAB metric (|ΔLr| + √(Δa² + Δb²)), which tracks large color differences well.
 * The Lr lightness is toe-corrected OKLab lightness, which avoids over-expanding
 * near-black image/display differences while preserving the black-white 0..1 scale.
 * Caller guarantees the two pixels differ, so the early-zero check is omitted.
 *
 * The HyAB sqrt is avoided by folding the threshold test in: the distance stays below `maxDelta`
 * iff |ΔLr| <= maxDelta and Δa² + Δb² <= (maxDelta − |ΔLr|)². The return value is only used
 * for the threshold comparison and the brighter/darker sign, so it's just 0 / ±1.
 *
 * @param {Uint8Array | Uint8ClampedArray} img1
 * @param {Uint8Array | Uint8ClampedArray} img2
 * @param {number} k pixel offset (same in both images)
 * @param {boolean} checkerboard
 * @param {number} maxDelta maximum acceptable HyAB distance
 * @return {number} 0 if below the threshold, otherwise ±1 (negative if the img2 pixel is darker)
 */
export function colorDelta(img1, img2, k, checkerboard, maxDelta) {
    const r1 = img1[k];
    const g1 = img1[k + 1];
    const b1 = img1[k + 2];
    const a1 = img1[k + 3];
    const r2 = img2[k];
    const g2 = img2[k + 1];
    const b2 = img2[k + 2];
    const a2 = img2[k + 3];

    if (a1 === 255 && a2 === 255) { // fast path for opaque colors
        return colorDeltaOpaque(r1, g1, b1, r2, g2, b2, maxDelta);
    }

    return colorDeltaTransparent(r1, g1, b1, a1, r2, g2, b2, a2, k, checkerboard, maxDelta);
}

/**
 * @param {number} r1
 * @param {number} g1
 * @param {number} b1
 * @param {number} r2
 * @param {number} g2
 * @param {number} b2
 * @param {number} maxDelta
 */
function colorDeltaOpaque(r1, g1, b1, r2, g2, b2, maxDelta) {
    const key1 = (r1 << 16) | (g1 << 8) | b1;
    const slot1 = Math.imul(key1, 0x9e3779b1) >>> OKLAB_CACHE_SHIFT;
    const stored1 = key1 + 1;
    const offset1 = slot1 * 4;
    let l1, m1, s1, lr1;
    if (OKLAB_CACHE_KEYS[slot1] === stored1) {
        l1 = OKLAB_CACHE_VALUES[offset1];
        m1 = OKLAB_CACHE_VALUES[offset1 + 1];
        s1 = OKLAB_CACHE_VALUES[offset1 + 2];
        lr1 = OKLAB_CACHE_VALUES[offset1 + 3];
    } else {
        l1 = cbrtLUT(L_R[r1] + L_G[g1] + L_B[b1]);
        m1 = cbrtLUT(M_R[r1] + M_G[g1] + M_B[b1]);
        s1 = cbrtLUT(S_R[r1] + S_G[g1] + S_B[b1]);
        lr1 = lightness(l1, m1, s1);
        OKLAB_CACHE_KEYS[slot1] = stored1;
        OKLAB_CACHE_VALUES[offset1] = l1;
        OKLAB_CACHE_VALUES[offset1 + 1] = m1;
        OKLAB_CACHE_VALUES[offset1 + 2] = s1;
        OKLAB_CACHE_VALUES[offset1 + 3] = lr1;
    }

    const key2 = (r2 << 16) | (g2 << 8) | b2;
    const slot2 = Math.imul(key2, 0x9e3779b1) >>> OKLAB_CACHE_SHIFT;
    const stored2 = key2 + 1;
    const offset2 = slot2 * 4;
    let l2, m2, s2, lr2;
    if (OKLAB_CACHE_KEYS[slot2] === stored2) {
        l2 = OKLAB_CACHE_VALUES[offset2];
        m2 = OKLAB_CACHE_VALUES[offset2 + 1];
        s2 = OKLAB_CACHE_VALUES[offset2 + 2];
        lr2 = OKLAB_CACHE_VALUES[offset2 + 3];
    } else {
        l2 = cbrtLUT(L_R[r2] + L_G[g2] + L_B[b2]);
        m2 = cbrtLUT(M_R[r2] + M_G[g2] + M_B[b2]);
        s2 = cbrtLUT(S_R[r2] + S_G[g2] + S_B[b2]);
        lr2 = lightness(l2, m2, s2);
        OKLAB_CACHE_KEYS[slot2] = stored2;
        OKLAB_CACHE_VALUES[offset2] = l2;
        OKLAB_CACHE_VALUES[offset2 + 1] = m2;
        OKLAB_CACHE_VALUES[offset2 + 2] = s2;
        OKLAB_CACHE_VALUES[offset2 + 3] = lr2;
    }

    return oklabHyabDelta(lr1 - lr2, l1 - l2, m1 - m2, s1 - s2, maxDelta);
}

/**
 * @param {number} r1
 * @param {number} g1
 * @param {number} b1
 * @param {number} a1
 * @param {number} r2
 * @param {number} g2
 * @param {number} b2
 * @param {number} a2
 * @param {number} k
 * @param {boolean} checkerboard
 * @param {number} maxDelta
 */
function colorDeltaTransparent(r1, g1, b1, a1, r2, g2, b2, a2, k, checkerboard, maxDelta) {
    // blend pixels with background
    let rb = 255, gb = 255, bb = 255;
    if (checkerboard) {
        // pick one of 8 dark/light background colors per pixel from the top 3 bits of a Fibonacci
        // hash of its index (uniform and independent per channel), so that no pair of colors that
        // only differ in alpha can look alike over more than 1/8 of the pixels
        const h = Math.imul(k >> 2, 0x9e3779b1);
        rb = 48 + 159 * (h >>> 31);
        gb = 48 + 159 * ((h >>> 30) & 1);
        bb = 48 + 159 * ((h >>> 29) & 1);
    }
    // blended channel values are fractional, so interpolate the sRGB->linear LUT
    r1 = (r1 * a1 + rb * (255 - a1)) / 255;
    g1 = (g1 * a1 + gb * (255 - a1)) / 255;
    b1 = (b1 * a1 + bb * (255 - a1)) / 255;
    r2 = (r2 * a2 + rb * (255 - a2)) / 255;
    g2 = (g2 * a2 + gb * (255 - a2)) / 255;
    b2 = (b2 * a2 + bb * (255 - a2)) / 255;
    const lr1 = linLUT(r1), lg1 = linLUT(g1), lb1 = linLUT(b1);
    const lr2 = linLUT(r2), lg2 = linLUT(g2), lb2 = linLUT(b2);

    const l1 = cbrtLUT(0.4122214708 * lr1 + 0.5363325363 * lg1 + 0.0514459929 * lb1);
    const m1 = cbrtLUT(0.2119034982 * lr1 + 0.6806995451 * lg1 + 0.1073969566 * lb1);
    const s1 = cbrtLUT(0.0883024619 * lr1 + 0.2817188376 * lg1 + 0.6299787005 * lb1);
    const l2 = cbrtLUT(0.4122214708 * lr2 + 0.5363325363 * lg2 + 0.0514459929 * lb2);
    const m2 = cbrtLUT(0.2119034982 * lr2 + 0.6806995451 * lg2 + 0.1073969566 * lb2);
    const s2 = cbrtLUT(0.0883024619 * lr2 + 0.2817188376 * lg2 + 0.6299787005 * lb2);
    const Lr1 = lightness(l1, m1, s1);
    const Lr2 = lightness(l2, m2, s2);

    return oklabHyabDelta(Lr1 - Lr2, l1 - l2, m1 - m2, s1 - s2, maxDelta);
}

/**
 * @param {number} dLr
 * @param {number} dl
 * @param {number} dm
 * @param {number} ds
 * @param {number} maxDelta
 */
function oklabHyabDelta(dLr, dl, dm, ds, maxDelta) {
    // HyAB distance = |dLr| + sqrt(da^2 + db^2); compare against maxDelta without the sqrt:
    // it stays below the threshold iff |dLr| <= maxDelta and da^2 + db^2 <= (maxDelta - |dLr|)^2
    const rest = maxDelta - Math.abs(dLr);
    if (rest >= 0) {
        const da = 1.9779984951 * dl - 2.4285922050 * dm + 0.4505937099 * ds;
        const db = 0.0259040371 * dl + 0.7827717662 * dm - 0.8086757660 * ds;
        if (da * da + db * db <= rest * rest) return 0;
    }

    // encode whether the pixel lightens or darkens in the sign
    return dLr > 0 ? -1 : 1;
}

/**
 * Toe-corrected OKLab lightness (Lr) from cube-rooted LMS values.
 * @param {number} l
 * @param {number} m
 * @param {number} s
 */
function lightness(l, m, s) {
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const x = TOE_K3 * L - TOE_K1;
    return 0.5 * (x + Math.sqrt(x * x + 4 * TOE_K2 * TOE_K3 * L));
}

/**
 * Specialized brightness-only color delta for the anti-aliasing detector,
 * with the center pixel's RGBA hoisted out of the neighbor loop.
 *
 * Intentionally stays on gamma-space Rec.601 luma rather than OKLab ΔL used by `colorDelta`:
 * the detector only needs a cheap, monotonic scalar to find the intensity ramp direction
 * (darkest/brightest neighbor), and switching to ΔL both regressed AA detection on dark regions
 * and was much slower (called up to 16× per candidate pixel).
 *
 * Semi-transparent pixels are composited over fixed white rather than the checkerboard
 * used by `colorDelta`: a ramp structure test needs a deterministic background, and a
 * pseudo-random per-position one distorts the very ramps it looks for. White (rather than
 * mid-gray) matches the pre-checkerboard blending that some callers depend on. When the composited
 * luma delta cancels out exactly but alpha differs, the alpha delta gives the ramp direction,
 * so only pixels equal in both premultiplied luma and alpha count as equal siblings.
 * @param {Uint8Array | Uint8ClampedArray} img
 * @param {number} m neighbor pixel offset
 * @param {number} r1
 * @param {number} g1
 * @param {number} b1
 * @param {number} a1
 */
