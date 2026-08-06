// stone.js — the surface of the stone, as a SOLID texture in world space.
//
// THE TEXTURE IS 3-D, NOT PER FACE, and that is the whole reason this file
// exists rather than a `u,v` lookup.
//
// A block's faces are cut through one lump of rock.  Evaluate the texture at the
// world point a pixel actually stands on and the mottling runs round an arris
// without a seam, a stair's tread and its riser belong to the same stone, and
// two blocks standing side by side are two pieces of the same quarry rather than
// two copies of one tile.  Per-face texture coordinates give you none of that,
// and give you the tiling artefact for free.
//
// IT IS ALSO BAND-LIMITED, which matters more than it sounds.  The build camera
// is nearly orthographic and the explore camera is inside the building, so the
// same texture is seen at wildly different scales in the same session.  An
// octave whose features are finer than a pixel does not add detail — it adds
// noise, and when the camera moves it adds CRAWLING noise, which reads as a
// broken shader rather than as stone.  So each octave is faded out as it
// approaches the pixel size and the finest visible octave is always the finest
// one that can be resolved.  This is a mip-map, done by hand, because there is
// no sampler here to do it.

/* ------------------------------------------------------------------ noise -- */

/** Integer hash → [0,1).  Same finaliser as math.js; kept local so the texture
 *  has no dependency and can be lifted into a tool on its own. */
function h3(x, y, z) {
  // ONE ROUND, not the three that math.js uses.  This is called eight times per
  // octave per pixel — around twenty million times a frame with the camera
  // inside the building — and it is decorating a surface, not seeding a
  // simulation.  The full finaliser cost 40% of the fill and the difference is
  // not visible in stone.
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h ^= h >>> 13; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Trilinear value noise, smoothstepped.  Cheap and — at these amplitudes —
 * indistinguishable from gradient noise, which costs three times as much.
 *
 * WRITTEN FLAT ON PURPOSE.  The readable version of this took a `c(dx,dy,dz)`
 * closure over the cell corner, which is one allocation per octave per pixel:
 * five octaves over 700 000 pixels is three and a half million closures a
 * frame, and it turned a 300 ms plate into a 1000 ms one.  This is the only hot
 * loop in the project that runs per pixel rather than per face, and it is worth
 * being ugly in exactly here and nowhere else.
 */
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz), b = h3(ix + 1, iy, iz);
  const c = h3(ix, iy + 1, iz), d = h3(ix + 1, iy + 1, iz);
  const e = h3(ix, iy, iz + 1), f = h3(ix + 1, iy, iz + 1);
  const g = h3(ix, iy + 1, iz + 1), k = h3(ix + 1, iy + 1, iz + 1);
  const x00 = a + (b - a) * fx, x10 = c + (d - c) * fx;
  const x01 = e + (f - e) * fx, x11 = g + (k - g) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/* ------------------------------------------------------------------ stone -- */

/**
 * The octaves, coarsest first.  `size` is the feature size in LATTICE UNITS —
 * one unit is 1.5 m — and `amp` is how much of the tonal range it may move.
 *
 * The coarse two are the block's own colour variation, the middle one is the
 * mottle you see across a wall from a few metres, and the fine two are the
 * grain you only get close enough to see indoors.  Together they run about
 * ±0.13 of tone, which is a stone that is clearly not flat and clearly not a
 * noise field.
 */
// Flat parallel arrays, not an array of pairs: the destructuring `for…of` in
// the first version allocated an iterator per pixel.  Same reason as vnoise.
// FOUR, not five.  A fifth octave at 0.062 units — 9 cm — costs eight more
// hashes on every pixel of the frame and is only ever resolvable with your nose
// against the wall in explore mode.  The grain at that scale is better spent on
// the pit term, which is one noise lookup and does more for the surface than
// another smooth octave does.
const OCT_INV = new Float64Array([1 / 3.10, 1 / 1.30, 1 / 0.46, 1 / 0.17]);
const OCT_SIZE = new Float64Array([3.10, 1.30, 0.46, 0.17]);
const OCT_AMP = new Float64Array([0.092, 0.074, 0.058, 0.044]);

/** Pits and dark inclusions: sparse, small, and the thing that stops a surface
 *  reading as fabric.  A threshold on the finest noise, not another octave —
 *  aggregate is not smooth. */
const PIT_SIZE = 0.085;
const PIT_GATE = 0.845;
const PIT_DEPTH = 0.42;

/**
 * @param {number} x,y,z    the world point, in lattice units
 * @param {number} wpp      world units per output pixel at this depth.  Octaves
 *                          finer than this are faded out; pass 0 to disable
 *                          band-limiting (the instruments do, to see the raw
 *                          texture at full depth).
 * @returns {number} a signed tone offset, roughly −0.16…+0.16.  ADD it to the
 *                   face's tone: positive is darker, because tone is darkness.
 */
export function stoneAt(x, y, z, wpp = 0) {
  let v = 0;
  const lim = wpp * 2.4;
  for (let i = 0; i < OCT_SIZE.length; i++) {
    // Fade an octave out over the last doubling before it hits the pixel grid,
    // rather than dropping it at a threshold — a hard cut-off makes a visible
    // ring on the ground where the mip level changes.
    let k = 1;
    if (wpp > 0) {
      k = (OCT_SIZE[i] / lim) - 1;
      if (k <= 0) break;                    // and every finer octave too
      if (k > 1) k = 1;
    }
    const s = OCT_INV[i];
    v += (vnoise(x * s, y * s, z * s) - 0.5) * 2 * OCT_AMP[i] * k;
  }
  if (wpp <= 0 || PIT_SIZE > wpp * 2.4) {
    const s = 1 / PIT_SIZE;
    const p = vnoise(x * s + 71.3, y * s + 17.9, z * s + 43.1);
    if (p > PIT_GATE) v += (p - PIT_GATE) / (1 - PIT_GATE) * PIT_DEPTH;
  }
  return v;
}

/**
 * BEDDING.  Sedimentary stone is laid down in horizontal beds, and a block cut
 * from it carries faint horizontal banding whatever face you look at.  It is a
 * small effect and it is most of what separates "stone" from "concrete": strong
 * enough at 0.03 to be felt, weak enough not to read as a stripe.
 */
export function beddingAt(z, wpp = 0) {
  if (wpp > 0.14) return 0;
  return Math.sin(z * 7.4) * 0.014 + Math.sin(z * 2.3 + 1.7) * 0.016;
}
