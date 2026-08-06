// engrave.js — the plate is bitten here.
//
// The pass order is the etcher's own, and it is not an accident of code:
//
//   1. collect      every face of every placed block, in world coordinates
//   2. cancel       faces that lie back-to-back with a neighbour's — see world.js
//   3. rasterise    a depth + face-id buffer.  Nothing is SHADED into it; it
//                   exists only to answer "is this point in front?"
//   4. bite lines   silhouettes, creases and borders, clipped against (3)
//   5. lay tone     hatching, in each face's own plane, clipped against (3)
//   6. course       masonry joints, so the mass reads as built and not moulded
//
// THE ONE THING TO UNDERSTAND ABOUT THIS FILE: the depth buffer is a stencil,
// not a picture.  Every mark on the plate is an analytic stroke with a start, an
// end, a width profile and a hand; the buffer only ever says yes or no.  That is
// the difference between a drawing and a filtered render, and it is why there is
// no post-process anywhere in this repo.

import { Plate } from './ink.js';
import { bandTone, bandLine, faceWarmth, stoneRange } from './palette.js';
import { stoneAt, beddingAt } from './stone.js';
import { projectWith, hash32, hashf, hashs, norm, cross, sub } from './math.js';
import { MATERIALS } from './mesh.js';
import { turnY, translate } from './mesh.js';

const NEAR = 0.08;

/* -------------------------------------------------------------- the light */

/**
 * THE LIGHT IS FIXED IN THE WORLD, NEVER TO THE CAMERA.  Orbit a camera around
 * a scene lit from the eye and the building relights itself as you turn, which
 * is the single most video-game thing a renderer can do.  Piranesi's light comes
 * from a high opening off to one side and it stays there.
 *
 * There are three terms, and the FIRST one is the one that matters:
 *
 *   1. SKY VISIBILITY — can this surface see the opening at all?  Not "does it
 *      face upward", which is a cheap stand-in for the same idea: an actual
 *      march through the lattice, asking whether anything is in the way.  This
 *      is why the inside of a vault is black and the top of the same vault is
 *      bare paper, and it is why a tunnel gets darker the further in you look,
 *      which no normal-based model can produce.  It is the difference between a
 *      building that is lit and a building that is merely shaded.
 *   2. A KEY, for lateral modelling, so two walls at right angles differ.
 *   3. The material's own bias.
 */
const KEY = norm([-0.42, -0.66, 0.62]);
const SKY_W = 0.32;
const KEY_W = 0.38;
/**
 * The bounce floor.  Direct visibility of the opening is ONE bounce, and one
 * bounce says that a vaulted hall fifty metres long with arcade openings down
 * its sides is uniformly black — which is true of the geometry and false of
 * every interior anyone has ever drawn.  Light in a masonry room arrives mostly
 * off other masonry.  Without this term the plate came back 71% near-black with
 * a correctly calibrated hatcher underneath it, and the fault was two files
 * upstream of where it showed.
 */
const AMBIENT_BOUNCE = 0.24;
/** A little more for surfaces that can also see the opening directly — the
 *  bounce is brighter near the light, which is what softens a shadow edge. */
const AMBIENT_SKY = 0.12;
/** How far the key ray travels before it has escaped the building.  Longer than
 *  the sky reach: the sky only has to clear the vault, the key has to get out
 *  of a hall fifty metres long. */
const KEY_REACH = 22;

/** Directions the sky is sampled along: straight up, and a ring leaning out.
 *  Six is enough — the term wants to be soft, and a hard shadow from a skylight
 *  is not what an etcher draws anyway. */
const SKY_RAYS = (() => {
  const out = [[0, 0, 1, 0.30]];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const lean = 0.72;
    const d = norm([Math.cos(a) * lean, Math.sin(a) * lean, 0.86]);
    out.push([d[0], d[1], d[2], 0.14]);
  }
  return out;
})();

const SKY_REACH = 11;     // cells to march before declaring the sky found

/**
 * Exact voxel traversal (Amanatides & Woo): visit every cell the ray actually
 * passes through, in order, and no others.
 *
 * THE FIXED-STEP VERSION OF THIS WAS A BUG AND IT LOOKED LIKE ART.  Sampling a
 * lattice every 0.62 cells means a ray running near a cell corner alternately
 * lands inside and outside it, so a shadow boundary breaks up into stripes —
 * and the plate came back with broad pale bands radiating from the vanishing
 * point down the walls and across the floor, which read entirely plausibly as
 * shafts of light through the arcade.  They were sampling artefacts.  A ray
 * that steps through a grid must step CELL BY CELL; there is no tolerance that
 * makes a fixed stride correct, only strides that alias more slowly.
 *
 * @returns true if something other than `self` blocks the ray.
 */
function marchBlocked(occ, px, py, pz, dx, dy, dz, maxDist, self) {
  let cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  const dtx = ax > 1e-9 ? 1 / ax : Infinity;
  const dty = ay > 1e-9 ? 1 / ay : Infinity;
  const dtz = az > 1e-9 ? 1 / az : Infinity;
  let tx = ax > 1e-9 ? (dx > 0 ? cx + 1 - px : px - cx) / ax : Infinity;
  let ty = ay > 1e-9 ? (dy > 0 ? cy + 1 - py : py - cy) / ay : Infinity;
  let tz = az > 1e-9 ? (dz > 0 ? cz + 1 - pz : pz - cz) / az : Infinity;

  for (let guard = 0; guard < 512; guard++) {
    const hit = occ.get(`${cx},${cy},${cz}`);
    if (hit !== undefined && hit !== self) return true;
    if (tx < ty) {
      if (tx < tz) { cx += sx; if (tx > maxDist) return false; tx += dtx; }
      else { cz += sz; if (tz > maxDist) return false; tz += dtz; }
    } else if (ty < tz) { cy += sy; if (ty > maxDist) return false; ty += dty; }
    else { cz += sz; if (tz > maxDist) return false; tz += dtz; }
  }
  return false;
}

/**
 * March the lattice and return how much of the opening this point can see.
 *
 * `self` is the anchor key of the block the surface belongs to, and passing it
 * is not optional.  A face sits INSIDE its own cell, so the first thing every
 * ray meets is the block it started from — which reported total darkness for
 * every surface in the world, and produced a paved floor in open daylight
 * rendered as solid black.  A visibility ray must always be told what not to
 * count as an obstruction.
 */
function skyVisibility(world, p, n, self) {
  let seen = 0, total = 0;
  // THE SOLIDITY MAP, NOT THE OCCUPANCY MAP.  A block reserves its whole box
  // but is mostly hole; marching what it reserves makes an arcade as opaque as
  // a wall.  See world.js and solidity.js.
  const occ = world.solid || world.occupancy;
  const ox = p[0] + n[0] * 0.03, oy = p[1] + n[1] * 0.03, oz = p[2] + n[2] * 0.03;
  for (const [dx, dy, dz, wgt] of SKY_RAYS) {
    const face = dx * n[0] + dy * n[1] + dz * n[2];
    if (face <= 0.02) continue;                 // the ray is behind the surface
    const w = wgt * face;
    total += w;
    if (!marchBlocked(occ, ox, oy, oz, dx, dy, dz, SKY_REACH, self)) seen += w;
  }
  return total > 0 ? seen / total : 0;
}

/**
 * Can the key light actually reach this point?
 *
 * THE KEY HAS TO TRAVEL.  Weighting a lambert term by "how enclosed the surface
 * is" seems reasonable and is not: inside a hall every surface is enclosed, so
 * the key gets damped to nothing everywhere and the whole plate comes back one
 * even grey — which is what the third plate pulled from this renderer looked
 * like.  Piranesi's light is not ambient.  It comes IN, through an arch, at an
 * angle, and it lands on some things and not others; the bright wall opposite an
 * opening and the black wall beside it are the same wall.
 *
 * So the key is a shadow ray, marched through the same lattice.  One ray per
 * sample point, three sample points per face, blended — which also gives the
 * shadow a soft edge for free, and a hard-edged shadow is not an etching.
 */
function keyVisibility(world, p, n, self) {
  return marchBlocked(world.solid || world.occupancy,
    p[0] + n[0] * 0.03, p[1] + n[1] * 0.03, p[2] + n[2] * 0.03,
    KEY[0], KEY[1], KEY[2], KEY_REACH, self) ? 0 : 1;
}

/** Sky at three points spread up the face, so a WALL GETS A GRADIENT.
 *  One value per face makes every surface a flat panel of even tone, which is
 *  the thing no etching has: light falls off along a wall, and the falloff is
 *  most of what tells you how deep a space is. */
function skyProfile(world, inst, f, self) {
  const cen = faceCentroid(inst, f);
  let loI = f.v[0], hiI = f.v[0], loZ = Infinity, hiZ = -Infinity;
  for (const i of f.v) {
    const z = inst.verts[i][2];
    if (z < loZ) { loZ = z; loI = i; }
    if (z > hiZ) { hiZ = z; hiI = i; }
  }
  // Pull the extremes 22% toward the centre so a sample never lands on the
  // arris, where it would read the neighbouring block instead of this surface.
  const pull = (i) => {
    const p = inst.verts[i];
    return [p[0] + (cen[0] - p[0]) * 0.22, p[1] + (cen[1] - p[1]) * 0.22, p[2] + (cen[2] - p[2]) * 0.22];
  };
  const pts = hiZ - loZ < 1e-3 ? [cen] : [pull(loI), cen, pull(hiI)];
  const facesKey = f.n[0] * KEY[0] + f.n[1] * KEY[1] + f.n[2] * KEY[2] > 0.02;
  return pts.map((p) => ({
    p,
    sky: skyVisibility(world, p, f.n, self),
    key: facesKey ? keyVisibility(world, p, f.n, self) : 0,
  }));
}

/** Inverse-distance blend of a face's light samples at an arbitrary point. */
function lightAt(samples, p) {
  if (samples.length === 1) return samples[0];
  let num = 0, kum = 0, den = 0;
  for (const s of samples) {
    const dx = p[0] - s.p[0], dy = p[1] - s.p[1], dz = p[2] - s.p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < 1e-6) return s;
    const w = 1 / d;
    num += s.sky * w; kum += s.key * w; den += w;
  }
  return { sky: num / den, key: kum / den };
}

/**
 * Tone in [0,1], 0 = bare paper, 1 = solid black.
 *
 * The S-CURVE AT THE END IS LOAD-BEARING.  A linear lambert→density map fills a
 * plate with mid-grey, and mid-grey is the one value a Carceri does not contain:
 * the plates are close to bimodal — bare paper against near-solid black, with
 * the middle registers used sparingly and mostly on receding planes.  So the
 * tone is pushed away from the middle before it ever reaches the hatcher.
 */
function faceTone(n, mat, fog, sky, keyVis) {
  const lambert = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2]);
  // The bounce is not isotropic: an upward-facing surface sees more of the room
  // and more of whatever the room is lit by, so it keeps a share of the sky
  // term's shape even where it can see no sky at all.
  const bounce = AMBIENT_BOUNCE * (0.62 + 0.38 * (n[2] + 1) * 0.5);
  const lum = SKY_W * sky + KEY_W * lambert * keyVis + bounce + AMBIENT_SKY * sky;
  let t = 1 - lum;
  t += MATERIALS[mat] ? MATERIALS[mat].tone : 0;
  // CLAMP BEFORE THE CURVE, NOT AFTER.  The material bias is added to a value
  // that is already near 1 on an unlit face, and iron carries +0.28 — so t goes
  // over 1, `1 − t` goes negative, and `Math.pow(negative, 1.45)` below is NaN.
  // A NaN tone does not throw and does not draw: it sails through the hatcher's
  // `tone <= paperBelow` guard (every comparison against NaN is false) and comes
  // out as strokes of NaN width, so the ironwork on the darkest faces was simply
  // MISSING and nothing said so.  Thirty-one faces of fourteen blocks.  Found by
  // auditing the per-band tone table, not by looking at a picture.
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  // Contrast about a pivot below the middle — the darks are the subject.
  //
  // THIS CURVE USED TO BE MUCH HARDER, on the assumption that a Carceri is
  // bimodal: bare paper against solid black.  Block-histogram measurement of
  // real impressions says that is wrong.  A first-state plate lands near
  // bare 1%, light 16%, MID 40%, dark 38%, very dark 5%, solid 0% — mean
  // reflectance 0.46, ink coverage 55%.  It is a mid-and-dark object with
  // almost no bare paper and no true solids at all.  (The second state is the
  // one that is more than half black: median reflectance 0.11.)  So the curve
  // firms the contrast without evacuating the middle.
  const P = 0.44, K = 1.45;
  t = t < P ? P * Math.pow(Math.max(0, t) / P, K) : 1 - (1 - P) * Math.pow((1 - t) / (1 - P), K);

  // Aerial perspective is applied in the HATCHER, by taking away families and
  // thinning the needle — not here.  Fading tone toward the paper is a grey
  // ramp, and an etched line is either bitten or it is not.  A little is kept
  // here only to stop the deep distance filling in.
  t *= 1 - fog * 0.22;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/* --------------------------------------------------------- face gathering */

/**
 * @param blocks   the blocks THIS PASS draws.  The build view renders in two
 *   passes — the working layer with everything under it, then the layers above
 *   it as ghosts — and each pass gets its own set, its own stencil and its own
 *   cancellation.  Cancelling ACROSS passes would be the obvious economy and it
 *   is wrong: a ghosted block sitting on the working layer would delete the
 *   working layer's top face, and the layer you are actually building on has to
 *   read as a whole solid object.
 * @param faceId   where to start numbering, so two passes share one id space
 *   and one faceBlock table.
 */
function instances(world, catalog, blocks, faceId = 0) {
  const out = [];
  for (const b of blocks) {
    const def = catalog.get(b.id);
    if (!def) continue;
    const [ax, ay] = def.size;
    const turn = turnY(b.rot, ax, ay);
    const move = translate(b.x, b.y, b.z);
    const xf = (p) => move(turn(p));
    const mesh = def.mesh;

    // THE STROKE SEED IS THE BLOCK'S PLACE IN THE WORLD, NOT ITS PLACE IN A LIST.
    //
    // `id` below is an incrementing counter and must stay one — it indexes the
    // stencil buffers, which are rebuilt every frame.  But every wobble, every
    // ragged stroke end and every omitted masonry perpend is a hash of the
    // face's identity, and if THAT came from the counter, then adding one block
    // low in the building would shift every later face's number and re-draw the
    // hand across the entire plate.  Lay a single paving slab and the whole
    // drawing shivers.  So the seed is derived from where the block actually
    // stands and which of its own faces this is; a face keeps its handwriting
    // for as long as it keeps its address.
    const blockSeed = hash32(b.x * 73856093, b.y * 19349663, b.z * 83492791);
    const verts = mesh.verts.map(xf);
    const faces = mesh.faces.map((f, localIndex) => {
      const rot = (d) => {
        const a = xf([0, 0, 0]), q = xf(d);
        return [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      };
      return {
        v: f.v, mat: f.mat, tag: f.tag, side: f.side, tone: f.tone, form: !!f.form,
        n: rot(f.n), hatchDir: rot(f.hatchDir),
        uW: rot(f.uAxis), vW: rot(f.vAxis),
        id: faceId++,
        seed: hash32(blockSeed, localIndex * 2654435761),
        block: b,
        /** buried against a neighbour's face — the surface CONTINUES here */
        cancelled: false,
        /** turned away from the eye this frame */
        back: false,
        alive: true,
      };
    });
    out.push({ block: b, verts, faces, edges: mesh.edges });
  }
  return { list: out, nextId: faceId };
}

/**
 * Cancel back-to-back faces.  Two faces that occupy the same place and point
 * opposite ways are both invisible; hashing the rounded vertex ring finds them
 * exactly, with no solidity declarations and no special case for multi-cell
 * blocks.  Only faces marked as lying ON a cell boundary are candidates, so two
 * genuinely coincident interior surfaces (a plank resting on a beam) are left
 * alone.
 */
function cancelCoincident(insts) {
  const bins = new Map();
  let killed = 0;
  for (const inst of insts) {
    for (const f of inst.faces) {
      if (!f.side) continue;
      const ring = f.v.map((i) => inst.verts[i])
        .map((p) => `${Math.round(p[0] * 8192)}:${Math.round(p[1] * 8192)}:${Math.round(p[2] * 8192)}`)
        .sort().join('|');
      let bin = bins.get(ring);
      if (!bin) bins.set(ring, (bin = []));
      bin.push({ inst, f });
    }
  }
  for (const bin of bins.values()) {
    if (bin.length < 2) continue;
    for (let i = 0; i < bin.length; i++) {
      for (let j = i + 1; j < bin.length; j++) {
        const a = bin[i].f, b = bin[j].f;
        if (!a.alive || !b.alive) continue;
        const d = a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2];
        if (d < -0.9) {
          a.alive = b.alive = false;
          a.cancelled = b.cancelled = true;
          killed += 2;
        }
      }
    }
  }
  return killed;
}

/* ------------------------------------------------------------ the buffers */

class Depth {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.z = new Float32Array(w * h);      // 1/Z; 0 = nothing, larger = nearer
    this.id = new Int32Array(w * h).fill(-1);
  }
  clear() { this.z.fill(0); this.id.fill(-1); }

  /** Is a point at (sx,sy) with this 1/Z in front of what is already there?
   *  The tolerance is RELATIVE because 1/Z is: an absolute epsilon that works at
   *  two metres lets a wall bleed through at fifty. */
  visible(sx, sy, iz) {
    const x = sx | 0, y = sy | 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const b = this.z[y * this.w + x];
    return b <= 0 || iz >= b * 0.9955;
  }
  idAt(sx, sy) {
    const x = sx | 0, y = sy | 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.id[y * this.w + x];
  }
  zAt(sx, sy) {
    const x = sx | 0, y = sy | 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.z[y * this.w + x];
  }
}

/**
 * The world point under a pixel, from the stencil.  Inverts the projection:
 * the buffer holds 1/Z, and X and Y follow from the pixel offset.
 * @returns null where nothing was drawn.
 */
export function unproject(depth, c, sx, sy) {
  const iz = depth.zAt(sx, sy);
  if (iz <= 0) return null;
  const Z = 1 / iz;
  const X = (sx - c.cx) * Z / c.F;
  const Y = -(sy - c.cy) * Z / c.F;
  return [
    c.ex + c.rx * X + c.ux * Y + c.fx * Z,
    c.ey + c.ry * X + c.uy * Y + c.fy * Z,
    c.ez + c.rz * X + c.uz * Y + c.fz * Z,
  ];
}

/** Clip a camera-space polygon to Z ≥ NEAR (Sutherland–Hodgman, one plane). */
function clipNear(cam) {
  const out = [];
  for (let i = 0; i < cam.length; i++) {
    const a = cam[i], b = cam[(i + 1) % cam.length];
    const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  return out;
}

/** Camera-space coordinates: X right, Y up, Z forward. */
function toCam(c, p) {
  const dx = p[0] - c.ex, dy = p[1] - c.ey, dz = p[2] - c.ez;
  return [
    dx * c.rx + dy * c.ry + dz * c.rz,
    dx * c.ux + dy * c.uy + dz * c.uz,
    dx * c.fx + dy * c.fy + dz * c.fz,
  ];
}
const camToScreen = (c, P) => {
  const iz = 1 / P[2];
  return [c.cx + c.F * P[0] * iz, c.cy - c.F * P[1] * iz, iz];
};

/**
 * Fill a convex screen polygon into the depth/id buffer.
 *
 * 1/Z is an AFFINE function of screen position for any plane, so there is no
 * per-pixel divide and no interpolation error: derive A,B,C once from the
 * camera-space plane and evaluate.  (This is also why the buffer stores 1/Z
 * rather than Z — Z is not affine in screen space and interpolating it bows the
 * surface, which shows up as hatching that punches through its own wall.)
 */
function fillPoly(depth, poly, A, B, C, id) {
  let top = Infinity, bot = -Infinity;
  for (const p of poly) { if (p[1] < top) top = p[1]; if (p[1] > bot) bot = p[1]; }
  let y0 = Math.max(0, Math.ceil(top - 0.5)), y1 = Math.min(depth.h - 1, Math.floor(bot - 0.5));
  const n = poly.length;
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
        const x = a[0] + (b[0] - a[0]) * (sy - a[1]) / (b[1] - a[1]);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    if (lo > hi) continue;
    let x0 = Math.max(0, Math.ceil(lo - 0.5)), x1 = Math.min(depth.w - 1, Math.floor(hi - 0.5));
    const row = y * depth.w;
    let iz = A * (x0 + 0.5) + B * sy + C;
    for (let x = x0; x <= x1; x++, iz += A) {
      const i = row + x;
      if (iz > depth.z[i]) { depth.z[i] = iz; depth.id[i] = id; }
    }
  }
}

/* ============================================================== the engraver */

export const DEFAULTS = {
  /** THE PITCH, in output pixels, held constant across the whole tonal range.
   *  Measured at ~0.80 mm on a 545 mm plate, i.e. plate width / 680; at 900 px
   *  wide that is 1.3 px, which is below what a raster can hold, so the game
   *  runs a coarser grain and keeps the RATIO that matters — tone is width over
   *  pitch, and that is scale-free. */
  pitchPx: 2.7,
  /** Bare paper below this tone.  Kept LOW: a first-state plate is about 1%
   *  bare paper.  Bare paper is an override (the etcher's stopped-out white),
   *  not the default state of a lit surface. */
  paperBelow: 0.045,
  creaseWidth: 1.15,
  silhouetteWidth: 1.9,
  courseWidth: 0.72,
  /** Distance, in cells, at which aerial perspective is fully applied. */
  fogDepth: 46,
  /** Cap on hatch lines per face — a runaway wall must degrade, not hang. */
  maxLinesPerFace: 420,
  /**
   * THE SKIN — which of the two pictures this is.
   *
   *   'stone'  a printed middle grey with a solid stone texture through it, and
   *            the lines doing nothing but outline.  The game's own look, after
   *            the owner saw the engraved one and said it was not right for
   *            this game.
   *   'hatch'  the software line engraver: no fills anywhere, every value on
   *            the sheet made of bitten line.  Kept whole and kept working —
   *            it is wanted for another project, and it is the more interesting
   *            renderer of the two.  `tools/plateshot.mjs --skin hatch`.
   */
  skin: 'stone',
  /** The middle grey, used where a face somehow reached the fill without a
   *  tone.  The light normally decides this per face. */
  stoneGrey: 0.46,
  coursing: true,
  hatching: true,
  lines: true,
};

export class Engraver {
  constructor({ width = 900, height = 1200, ss = 2 } = {}) {
    this.plate = new Plate(width, height, ss);
    this.depth = new Depth(width, height);
    this.width = width;
    this.height = height;
    this.ss = ss;
    /** Per output pixel, where the surface under it sits on the warm↔cool axis.
     *  Written from the stencil after tone is known; read once by `develop`. */
    this.warmth = new Float32Array(width * height);
    /** tone → duty table, and scratch for the per-stroke family weights. */
    this._duty = buildDutyTable();
    this._fw = new Float32Array(LAYERS.length);
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return this;
    this.plate = new Plate(width, height, this.ss);
    this.depth = new Depth(width, height);
    this.ghostDepth = null;
    this.warmth = new Float32Array(width * height);
    this.width = width; this.height = height;
    return this;
  }

  /**
   * THE TWO PASSES.
   *
   * In explore mode there is one pass and this is the renderer it always was.
   * In build mode there are two: the working layer and everything below it,
   * then — over the top, with its own stencil — the layers above, drawn faint.
   *
   * The second stencil is the point.  If the layers above shared the first
   * one they would occlude the layer you are trying to build on, which is
   * exactly what the ghosting exists to prevent.  Nothing is composited: the
   * ghost pass lays its (much thinner) ink onto the same plate, and because ink
   * is transmittance, a ghost crossing a solid darkens it slightly, which is
   * what a line drawn over a drawing does.
   */
  render(world, camera, catalog, opts = {}) {
    const O = { ...DEFAULTS, ...opts };
    const t0 = now();
    camera.setFraming({ width: this.width, height: this.height });
    const c = camera.snapshot();
    this.plate.clear();
    this.depth.clear();
    this.warmth.fill(0);
    // faceId → the block it belongs to.  This is what makes picking exact and
    // free: the stencil already knows which face is under every pixel, so the
    // cursor never needs a ray/box intersection routine at all.
    this.faceBlock = [];
    this.faceNormal = [];
    this.faceTone = [];

    // NULL, not 0.  "No layers here" and "on the working layer" are different
    // states: explore mode must draw the stone at its own value, while the
    // working layer is drawn with headroom so the layer below it has somewhere
    // to be darker.  See palette.js LIVE_HEAD.
    const bandOf = O.bandOf || (() => null);
    const solid = [], ghost = [];
    for (const b of world.blocks.values()) (bandOf(b) > 0 ? ghost : solid).push(b);

    const A = instances(world, catalog, solid, 0);
    const cancelled = cancelCoincident(A.list);
    const rA = this._pass(world, A.list, c, O, bandOf);

    let rB = { faces: 0, visible: 0, hatchLines: 0 };
    if (ghost.length) {
      const G = instances(world, catalog, ghost, A.nextId);
      cancelCoincident(G.list);
      if (!this.ghostDepth) this.ghostDepth = new Depth(this.width, this.height);
      this.ghostDepth.clear();
      // Swap the active stencil rather than threading one through twenty call
      // sites.  `this.depth` stays the SOLID buffer afterwards, which is what
      // picking reads — you build on the working layer, never on a ghost.
      const solidDepth = this.depth;
      this.depth = this.ghostDepth;
      rB = this._pass(world, G.list, c, O, bandOf);
      this.depth = solidDepth;
    }
    const tEnd = now();

    return {
      faces: rA.faces + rB.faces,
      visible: rA.visible + rB.visible,
      ghosted: rB.visible,
      cancelled,
      hatchLines: rA.hatchLines + rB.hatchLines,
      ms: { total: tEnd - t0, solid: rA.ms, ghost: rB.ms || 0 },
      ink: this.plate.meanInk(),
    };
  }

  _pass(world, insts, c, O, bandOf) {
    const t0 = now();
    for (const inst of insts) for (const f of inst.faces) {
      this.faceBlock[f.id] = inst.block;
      this.faceNormal[f.id] = f.n;
    }

    /* ---- 3. the stencil -------------------------------------------------- */
    const draw = [];                       // faces that survived, with screen data
    for (const inst of insts) {
      const cam = inst.verts.map((p) => toCam(c, p));
      inst.cam = cam;
      inst.scr = cam.map((P) => (P[2] > NEAR ? camToScreen(c, P) : null));
      for (const f of inst.faces) {
        if (f.cancelled) continue;
        f.back = false;
        // Backface: is the eye on the outside of this face's plane?
        const p0 = inst.verts[f.v[0]];
        const ex = p0[0] - c.ex, ey = p0[1] - c.ey, ez = p0[2] - c.ez;
        if (ex * f.n[0] + ey * f.n[1] + ez * f.n[2] > 0) { f.alive = false; f.back = true; continue; }

        const poly = clipNear(f.v.map((i) => cam[i]));
        if (poly.length < 3) { f.alive = false; continue; }
        const scr = poly.map((P) => camToScreen(c, P));

        // Reject faces entirely off the plate — but keep ones that straddle it.
        let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, zsum = 0;
        for (const s of scr) {
          if (s[0] < minx) minx = s[0]; if (s[0] > maxx) maxx = s[0];
          if (s[1] < miny) miny = s[1]; if (s[1] > maxy) maxy = s[1];
        }
        for (const P of poly) zsum += P[2];
        if (maxx < 0 || minx > this.width || maxy < 0 || miny > this.height) { f.alive = false; continue; }

        // 1/Z as an affine function of screen position.
        const nc = [
          f.n[0] * c.rx + f.n[1] * c.ry + f.n[2] * c.rz,
          f.n[0] * c.ux + f.n[1] * c.uy + f.n[2] * c.uz,
          f.n[0] * c.fx + f.n[1] * c.fy + f.n[2] * c.fz,
        ];
        const d = nc[0] * poly[0][0] + nc[1] * poly[0][1] + nc[2] * poly[0][2];
        if (Math.abs(d) < 1e-9) { f.alive = false; continue; }
        const A = nc[0] / (c.F * d);
        const B = -nc[1] / (c.F * d);
        const C = (-nc[0] * c.cx / c.F + nc[1] * c.cy / c.F + nc[2]) / d;

        fillPoly(this.depth, scr, A, B, C, f.id);
        f.plane = { A, B, C };
        f.zavg = zsum / poly.length;
        f.screenArea = Math.max(0, (maxx - minx)) * Math.max(0, (maxy - miny));
        draw.push({ inst, f });
      }
    }
    // WHAT SURVIVED THE STENCIL.  A face can pass every cull, rasterise
    // perfectly, and still contribute nothing because a nearer wall covers all
    // of it — and in a building most faces are exactly that.  One sweep of the
    // id buffer says which ids actually reached the paper, and everything else
    // skips its light rays, its hatching and its coursing entirely.  In a hall
    // this is most of the scene.
    const seen = new Set(this.depth.id);
    const visible = draw.filter(({ f }) => seen.has(f.id));

    // AERIAL PERSPECTIVE IS MEASURED FROM THE NEAREST THING DRAWN, NOT FROM THE
    // EYE.  It has to be, now that there are two cameras.  The build camera
    // stands 420 cells back with a long lens so that the view is near
    // orthographic — which put the entire model past `fogDepth`, so every face
    // was drawn at maximum haze: the thinnest needle, the fewest hatch families,
    // and tone knocked back 22%.  The layer bands then could not separate,
    // because a band asking for value 60 was being drawn with the equipment for
    // value 20.  Depth in a picture is depth THROUGH THE SUBJECT; how far the
    // draughtsman stands back is not part of it.
    let z0 = Infinity;
    for (const { f } of visible) if (f.zavg < z0) z0 = f.zavg;
    this._z0 = z0 = (z0 === Infinity ? 0 : z0);

    /* ---- 4 & 5 & 6 ------------------------------------------------------- */
    let hatchLines = 0;
    const warmById = new Map();
    const stone = O.skin === 'stone';
    if (stone || O.hatching || O.coursing) {
      for (const { inst, f } of visible) {
        const band = bandOf(inst.block);
        const fog = clamp01((f.zavg - z0) / O.fogDepth);
        // Must match world.js's anchor key exactly, or every ray is blocked by
        // the block it started from and the whole world renders black.
        const self = `${inst.block.layer || 'structure'}|${inst.block.x},${inst.block.y},${inst.block.z}`;
        f.skySamples = O.sky === false
          ? [{ p: faceCentroid(inst, f), sky: 0.62, key: 1 }]
          : skyProfile(world, inst, f, self);
        let mSky = 0, mKey = 0;
        for (const s of f.skySamples) { mSky += s.sky / f.skySamples.length; mKey += s.key / f.skySamples.length; }
        if (O.forceTone != null) {
          // The tone-verification harness drives this: every face takes one
          // known value so the achieved ink can be measured against intent.
          f.toneValue = O.forceTone;
          f.toneAt = () => O.forceTone;
        } else {
          // THE LAYER BAND IS APPLIED HERE, BEFORE A SINGLE STROKE IS DRAWN.
          // A ghosted face asks the hatcher for a third of its tone and the
          // hatcher draws a third of the line — so ghosting is not only
          // correct, it is most of the cost of a layer given back.  palette.js.
          // Order: light → the skin's own range → the layer band.  The stone
          // remap has to come first because it is a property of the MATERIAL
          // being a printed grey, and the band is a property of the drawing
          // board; banding a value that had not been brought into range yet
          // would spend the headroom twice.
          const shade = (t) => (stone ? stoneRange(t) : t);
          f.toneValue = bandTone(shade(faceTone(f.n, f.mat, fog, mSky, mKey) + (f.tone || 0)), band);
          f.toneAt = (p) => {
            const L = lightAt(f.skySamples, p);
            return clamp01(bandTone(shade(faceTone(f.n, f.mat, fog, L.sky, L.key) + (f.tone || 0)), band));
          };
        }
        // A ghost is drawn faint, so it is also drawn NEUTRAL: pushing a barely
        //-there layer warm or cool would make the layer above read as a
        // different material rather than as a different height.
        warmById.set(f.id, band > 0 ? 0 : faceWarmth(f.n, mSky));
        this.faceTone[f.id] = f.toneValue;      // what the instruments audit
        // The stone skin lays its tone as a printed area in one sweep after
        // this loop, so a face contributes no strokes at all — only its value.
        if (!stone && O.hatching) hatchLines += this.hatch(inst, f, c, f.toneValue, fog, O);
        if (!stone && O.coursing) this.course(inst, f, c, f.toneValue, fog, O);
      }
    }
    if (stone) this.stoneFill(c, O);
    if (O.lines) this.lineWork(insts, c, O, bandOf);

    // One sweep of the id buffer turns per-face warmth into the per-pixel field
    // `develop` reads.  Doing it here rather than per face keeps it O(pixels)
    // instead of O(faces × pixels), and the ghost pass simply overwrites where
    // its own stencil is set — which is right, because it is drawn over.
    const id = this.depth.id, wf = this.warmth;
    for (let i = 0; i < id.length; i++) {
      const k = id[i];
      if (k >= 0) { const w = warmById.get(k); if (w !== undefined) wf[i] = w; }
    }

    return { faces: draw.length, visible: visible.length, hatchLines, ms: now() - t0 };
  }

  /* ----------------------------------------------------------- stone skin */

  /**
   * THE STONE SKIN.  A printed middle grey with the stone in it, and the lines
   * left to do nothing but outline.
   *
   * This is a different picture from the engraved one, not a setting on it.
   * There, tone WAS line: every value on the sheet was made of hatching, and the
   * drawing described a surface by how it was stroked.  Here the surface is a
   * printed area with a texture through it, and the line work steps back to
   * being a contour — which is what an antique chromolithograph block does, and
   * the toy blocks are the reference.
   *
   * Done as one sweep of the finished stencil rather than per face.  The stencil
   * already answers "which face is under this pixel" and `unproject` already
   * inverts the projection, so every pixel can ask the world where it stands and
   * look the stone up THERE — a solid texture, continuous round an arris and
   * across two neighbouring blocks.  Per-face UVs would tile and would seam.
   */
  stoneFill(c, O) {
    const d = this.depth, F = this.plate.fill, w = this.width;
    const grey = O.stoneGrey ?? 0.46;
    let filled = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const id = d.id[i];
        if (id < 0) continue;
        const iz = d.z[i];
        if (iz <= 0) continue;
        const Z = 1 / iz;
        const X = (x + 0.5 - c.cx) * Z / c.F, Y = -(y + 0.5 - c.cy) * Z / c.F;
        const px = c.ex + c.rx * X + c.ux * Y + c.fx * Z;
        const py = c.ey + c.ry * X + c.uy * Y + c.fy * Z;
        const pz = c.ez + c.rz * X + c.uz * Y + c.fz * Z;
        // World units per pixel at this depth — the band limit.  Without it the
        // fine octaves alias into a crawling fizz the moment the camera moves.
        const wpp = Z / c.F;
        const t = (this.faceTone[id] ?? grey) + stoneAt(px, py, pz, wpp) + beddingAt(pz, wpp);
        // MULTIPLY, do not assign.  The ghost pass runs this a second time over
        // the same buffer, and a ghost is a haze laid OVER what is behind it;
        // assigning would let a pale layer above lighten the solid beneath it,
        // which is the one thing ghosting must never do.
        F[i] *= 1 - (t < 0 ? 0 : t > 1 ? 1 : t);
        filled++;
      }
    }
    this.plate.stats.filled = filled;
  }

  /* ------------------------------------------------------------ line work */

  /**
   * Silhouettes, creases and borders.
   *
   * A crease is a fact about the mesh and is known before the camera moves.  A
   * SILHOUETTE is not: it is where a face toward the eye meets a face away from
   * it, so it has to be found every frame, and it is the only reason the smooth
   * flank of a round tower has an outline at all.  Silhouettes get the heaviest
   * stroke on the plate, because that is what an etcher does — the contour that
   * separates a solid from what is behind it is bitten deepest.
   */
  lineWork(insts, c, O, bandOf = () => 0) {
    const P = this.plate, ss = this.ss;
    for (const inst of insts) {
      const eye = [c.ex, c.ey, c.ez];
      // A ghosted contour at full strength would out-shout the hatching it
      // belongs to, and the layer above would read as a wireframe laid over the
      // game rather than as a faint drawing of a block.
      const lw = bandLine(bandOf(inst.block));
      for (const e of inst.edges) {
        let kind = e.kind;
        let heavy = false;

        if (e.f.length === 2) {
          const fa = inst.faces[e.f[0]], fb = inst.faces[e.f[1]];

          // THE ARRIS IS NOT THERE IF THE FACE IS NOT THERE.  A face cancelled
          // against a neighbour means the stone CONTINUES through this edge —
          // the corner between a paving slab's top and its buried side is not a
          // corner, it is the middle of a floor.  Drawing it anyway is what
          // turns a paved hall into graph paper and a wall into a stack of
          // bricks the size of a room; every cell boundary in the building gets
          // ruled in.  It was the loudest fault on the first plate pulled.
          if (fa.cancelled || fb.cancelled) continue;

          const p0 = inst.verts[e.a];
          const d = [p0[0] - eye[0], p0[1] - eye[1], p0[2] - eye[2]];
          const sa = d[0] * fa.n[0] + d[1] * fa.n[1] + d[2] * fa.n[2] <= 0;
          const sb = d[0] * fb.n[0] + d[1] * fb.n[1] + d[2] * fb.n[2] <= 0;
          if (sa !== sb) { kind = 'silhouette'; heavy = true; }
          else if (kind === 'smooth') continue;         // interior of a curve
          else if (!sa && !sb) continue;                // both away: buried
        } else {
          if (inst.faces[e.f[0]].cancelled) continue;
          heavy = true;                                  // a border is an outline
        }

        const a = inst.verts[e.a], b = inst.verts[e.b];
        const seed = (inst.block.x * 73856093) ^ (inst.block.y * 19349663) ^ (inst.block.z * 83492791) ^ (e.a * 2654435761);
        // A ghost gets a thinner AND fainter needle; a shadowed layer gets a
        // fatter one at full strength.  Strength is an opacity and must never
        // exceed 1 — over 1 the transmittance multiply goes negative and the
        // pixel comes back brighter than paper.  Weight above 1 goes into the
        // width, which is where an etcher would put it anyway.
        this.strokeWorldEdge(a, b, c, {
          width: (heavy ? O.silhouetteWidth : O.creaseWidth) * (lw < 1 ? 0.72 : lw),
          strength: Math.min(1, lw),
          seed, kind, ss, plate: P, O,
        });
      }
    }
  }

  /** Walk a world-space segment in screen space, keeping the stretches that are
   *  in front, and lay each stretch down as one stroke with a hand in it. */
  strokeWorldEdge(a, b, c, opt) {
    const A = projectWith(c, a[0], a[1], a[2]);
    const B = projectWith(c, b[0], b[1], b[2]);
    if (A[2] <= 0 || B[2] <= 0) return;                 // TODO: clip, not drop
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = Math.hypot(dx, dy);
    if (L < 0.6) return;
    const steps = Math.min(600, Math.max(2, Math.ceil(L / 1.6)));
    const depth = this.depth, ss = opt.ss, P = opt.plate;

    // Weight falls with distance: the far arcade is drawn with a finer needle.
    // Measured from the nearest face in the pass, for the reason given in _pass.
    const zmid = 2 / (A[2] + B[2]) - (this._z0 || 0);
    const wgt = opt.width * clamp(1.25 - zmid / (opt.O.fogDepth * 1.4), 0.34, 1.25);

    let run = null;
    const flush = () => {
      if (run && run.length >= 4) {
        // Overshoot: an etched line runs past its corner more often than it
        // stops short of it.  Without this every junction is a mitred box and
        // the drawing looks like CAD.
        const over = 0.55 + hashf(opt.seed, 11) * 1.9;
        extend(run, over * ss);
        P.stroke(run, wgt * ss, (opt.kind === 'silhouette' ? 0.97 : 0.9) * (opt.strength ?? 1), 0.42);
      }
      run = null;
    };
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = A[0] + dx * t, sy = A[1] + dy * t;
      const iz = A[2] + (B[2] - A[2]) * t;
      if (depth.visible(sx, sy, iz)) {
        if (!run) run = [];
        // The hand: a slow lateral wander, ~1/3 px, keyed to the edge so it is
        // identical every frame.  Random per frame and the plate boils.
        const w = hashs(opt.seed, i >> 3) * 0.34 + Math.sin(t * 3.1 + hashf(opt.seed, 5) * 6.28) * 0.30;
        const nx = -dy / L, ny = dx / L;
        run.push((sx + nx * w) * ss, (sy + ny * w) * ss);
      } else flush();
    }
    flush();
  }

  /* -------------------------------------------------------------- hatching */

  /**
   * Lay tone on one face, in the face's own plane.
   *
   * Hatch line k is the locus of points whose projection on `perp` equals
   * k·spacing — and `perp` is a WORLD direction, so two coplanar faces that
   * happen to belong to different blocks land on the same set of lines and the
   * hatching runs unbroken across the join.  That single property is what stops
   * a wall of eight cells reading as eight panels.
   */
  hatch(inst, f, c, tone, fog, O) {
    if (tone <= O.paperBelow) return 0;
    if (f.screenArea < 6) return 0;

    const n = f.n;
    // A face that has a form to describe keeps its own frame; every other face
    // takes the hand's angle.  See the LAYERS comment.
    const hd = f.form ? f.hatchDir : (inPlaneAtScreenAngle(inst, f, c, PRIMARY_DEG) || f.hatchDir);
    const perp = norm(cross(n, hd));
    const p0 = inst.verts[f.v[0]];
    const d = p0[0] * n[0] + p0[1] * n[1] + p0[2] * n[2];
    const origin = [n[0] * d, n[1] * d, n[2] * d];

    // The polygon in the face's own (a,b) coordinates.
    const pts = planeCoords(inst, f, origin, hd, perp);

    // --- choose the spacing --------------------------------------------------
    // Measure, do not model: project one world step of `perp` at the face's own
    // depth and see how many pixels it covers.  Then climb a power-of-two ladder
    // until it lands in range.  A ladder rather than a continuous spacing
    // because halving keeps every second line where it already was, so a
    // surface changing register does not shimmer its whole hatch across.
    const cen = faceCentroid(inst, f);
    const s1 = projectWith(c, cen[0], cen[1], cen[2]);
    const s2 = projectWith(c, cen[0] + perp[0] * 0.1, cen[1] + perp[1] * 0.1, cen[2] + perp[2] * 0.1);
    if (s1[2] <= 0 || s2[2] <= 0) return 0;
    const pxPerUnit = Math.hypot(s2[0] - s1[0], s2[1] - s1[1]) / 0.1;
    if (!(pxPerUnit > 1e-4)) return 0;

    // THE PITCH IS CONSTANT, and it is chosen in SCREEN pixels: an engraving's
    // grain belongs to the plate, not to the building, so the hatch must be the
    // same fineness on a near pier as on a far one.  The world spacing that
    // achieves it is quantised to a root-two ladder rather than taken exactly,
    // so that two coplanar faces at slightly different depths land on the SAME
    // set of world lines and the hatching runs unbroken across the join.  A
    // continuous spacing would break every block boundary in the building.
    const want = O.pitchPx / pxPerUnit;
    const R2 = Math.SQRT2;
    let spacing = Math.pow(R2, Math.round(Math.log(want) / Math.log(R2)));
    if (!(spacing > 0) || !isFinite(spacing)) return 0;

    // Aerial perspective is a BITE-DEPTH ramp, not a grey ramp: distance takes
    // away layers and thins the needle.  It must never fade the ink toward the
    // paper — an etched line is either bitten or it is not.
    const maxFamilies = fog < 0.34 ? 3 : fog < 0.68 ? 2 : 1;
    const widthScale = (1 - fog * 0.55);

    let count = 0;
    for (let li = 0; li < LAYERS.length && li < maxFamilies; li++) {
      const L = LAYERS[li];
      if (tone < L.at) break;

      // Each family gets its own world direction, solved so that it PROJECTS at
      // the family's screen angle.  For a form-describing face the first family
      // is the surface's own, and the others are taken square to it in the
      // surface, so the wrap of a vault survives its own cross-hatching.
      // ONLY THE FIRST FAMILY DESCRIBES THE FORM.  Taking the cross square to
      // the wrap on a barrel vault gives "along the tunnel" x "round the
      // barrel", which is a perfect rectangular grid and reads as basketwork —
      // the vault came back looking woven.  Piranesi wraps the vault with his
      // first layer and then darkens it with the same 40-degree hand he uses
      // everywhere else.  So: family 0 keeps the surface frame, families 1 and
      // 2 take the plate angle whether the face has a form or not.
      const hd2 = (f.form && li === 0)
        ? hd
        : (inPlaneAtScreenAngle(inst, f, c, L.deg) || hd);
      const pp2 = norm(cross(n, hd2));

      const q = planeCoords(inst, f, origin, hd2, pp2);
      let lo = Infinity, hi = -Infinity;
      for (const p of q) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
      const k0 = Math.ceil(lo / spacing), k1 = Math.floor(hi / spacing);
      if (k1 - k0 > O.maxLinesPerFace) continue;

      for (let k = k0; k <= k1; k++) {
        const bb = k * spacing;
        const span = spanAt(q, bb);
        if (!span) continue;
        let [a0, a1] = span;
        if (a1 - a0 < spacing * 0.3) continue;       // a nub, not a stroke

        // --- how dark is it JUST HERE? ------------------------------------
        // Every stroke asks the face's own light profile where it lies, so the
        // needle swells and thins ALONG a wall as the light falls off it.  One
        // width per face makes every surface a flat panel of even tone, which
        // is the thing no etching has.
        const am = (a0 + a1) / 2;
        const tLoc = f.toneAt([
          origin[0] + hd2[0] * am + pp2[0] * bb,
          origin[1] + hd2[1] * am + pp2[1] * bb,
          origin[2] + hd2[2] * am + pp2[2] * bb,
        ]);
        // This family's own share at this point: zero until its tone is
        // reached, then ramping in over FAMILY_RAMP.
        familyWeights(tLoc, this._fw);
        const share = this._fw[li];
        if (share <= 0.002) continue;

        const base = this._duty.table[Math.round(clamp01(tLoc) * this._duty.N)];
        const width = base * share * O.pitchPx * widthScale;
        if (width < 0.16) continue;

        // The hand: an etcher's hatch block has a ragged edge, and the
        // raggedness is most of what distinguishes drawn tone from a fill
        // pattern.  IT IS AN ABSOLUTE AMOUNT, NOT A PERCENTAGE — as a
        // percentage it was 7% of each stroke, which on a one-cell face is two
        // pixels and on a wall four cells long is a finger's width, so every
        // block boundary in the building came back as a pale gutter and the
        // lattice was visible in the drawing.
        const bite = (0.8 + 2.2 * hashf(f.seed, k, li)) / pxPerUnit;
        const bite2 = (0.8 + 2.2 * hashf(f.seed, k, li + 97)) / pxPerUnit;
        if (a1 - a0 > (bite + bite2) * 2.5) { a0 += bite; a1 -= bite2; }
        if (a1 <= a0) continue;

        // A THIN LINE IS A FLICK; A WIDE ONE IS A TROUGH.  Taper is what makes
        // sparse hatching read as drawn rather than ruled, but carrying it into
        // the dark registers costs ~23% of every stroke's ink, and that is
        // exactly where the plate has none to spare — the transfer curve went
        // flat at 0.83 and the darkest passages could not get darker however
        // hard they were asked.  A line bitten until it is nearly as wide as
        // the gap beside it is blunt at both ends, which is also what it looks
        // like on the copper.
        const bluntness = clamp01(width / O.pitchPx);
        this.strokeHatch(origin, hd2, pp2, a0, a1, bb, c, {
          width,
          strength: 0.95 + 0.05 * bluntness,
          taper: 0.72 * (1 - bluntness),
          seed: (f.seed * 131 + k * 7 + li) | 0,
          arc: (hashs(f.seed, k, li + 41)) * 0.010 * (a1 - a0),
        });
        count++;
      }
    }
    return count;
  }

  /** One hatch stroke: world line → screen polyline → visible runs → ink. */
  strokeHatch(origin, hd, perp, a0, a1, b, c, opt) {
    const ss = this.ss, P = this.plate, depth = this.depth;
    const at = (t) => {
      const a = a0 + (a1 - a0) * t;
      // A drawn line is never dead straight; bow it very slightly.
      const bow = opt.arc * Math.sin(Math.PI * t);
      const bb = b + bow;
      return [
        origin[0] + hd[0] * a + perp[0] * bb,
        origin[1] + hd[1] * a + perp[1] * bb,
        origin[2] + hd[2] * a + perp[2] * bb,
      ];
    };
    const s0 = projectWith(c, ...at(0));
    const s1 = projectWith(c, ...at(1));
    if (s0[2] <= 0 || s1[2] <= 0) return;
    const L = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    if (L < 1.2) return;
    const steps = Math.min(220, Math.max(2, Math.ceil(L / 2.2)));

    let run = null;
    const flush = () => {
      if (run && run.length >= 4) P.stroke(run, opt.width * ss, opt.strength, opt.taper ?? 0.7);
      run = null;
    };
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = at(t);
      const s = projectWith(c, p[0], p[1], p[2]);
      if (s[2] > 0 && depth.visible(s[0], s[1], s[2])) {
        if (!run) run = [];
        run.push(s[0] * ss, s[1] * ss);
      } else flush();
    }
    flush();
  }

  /* -------------------------------------------------------------- coursing */

  /**
   * Masonry joints.  Without them a pier is a prism with stripes on it; with
   * them it is built.  The joints are drawn in the face's own plane at real
   * world heights, so a course runs unbroken from block to block up a wall —
   * the same trick as the hatch phase, and for the same reason.
   *
   * A COURSE IS INDEXED BY WORLD HEIGHT, NEVER BY SCREEN Y.  On a receding wall
   * a screen-horizontal joint is a diagonal slash across the stone.
   */
  course(inst, f, c, tone, fog, O) {
    const spec = MATERIALS[f.mat];
    if (!spec || spec.course === 'none') return;
    if (spec.course === 'grain') return this.grain(inst, f, c, O, fog);
    // In the deep registers the hatching has already eaten the joints; drawing
    // them anyway just adds ink with no information in it.
    if (tone > 0.80) return;
    if (Math.abs(f.n[2]) > 0.75) return this.flags(inst, f, c, tone, fog, O);
    const H = { ashlar: 0.25, rustic: 0.375, brick: 0.075 }[spec.course];
    if (!H) return;

    const along = norm(cross(f.n, [0, 0, 1]));   // in-plane horizontal
    if (!isFinite(along[0])) return;
    const p0 = inst.verts[f.v[0]];
    const d = p0[0] * f.n[0] + p0[1] * f.n[1] + p0[2] * f.n[2];
    const origin = [f.n[0] * d, f.n[1] * d, f.n[2] * d];
    const upDir = norm(cross(along, f.n));
    if (Math.abs(upDir[2]) < 1e-6) return;

    // `along` is horizontal by construction, so world height varies ONLY with b:
    //     z = origin.z + b·upDir.z      ⇒      b(z) = (z − origin.z) / upDir.z
    // (The first version of this sampled the plane at the point (0,0,z), which
    // is not in the plane, and was right only for walls that happened to face an
    // axis.  Derive it; do not sample it.)
    const bOf = (z) => (z - origin[2]) / upDir[2];

    let zLo = Infinity, zHi = -Infinity;
    for (const i of f.v) {
      const p = inst.verts[i];
      if (p[2] < zLo) zLo = p[2];
      if (p[2] > zHi) zHi = p[2];
    }

    // THE SCREEN GATE.  This is what stops masonry becoming graph paper.  An
    // etcher indicates coursing while a course is legible and stops the moment
    // it is not — he does not draw 2-pixel bricks, he draws a tone.  So measure
    // the course in PIXELS and bail out below about five; between five and ten,
    // draw every second course, which is exactly what indication looks like.
    const cen = faceCentroid(inst, f);
    const s1 = projectWith(c, cen[0], cen[1], cen[2]);
    const s2 = projectWith(c, cen[0] + upDir[0] * H, cen[1] + upDir[1] * H, cen[2] + upDir[2] * H);
    if (s1[2] <= 0 || s2[2] <= 0) return;
    const px = Math.hypot(s2[0] - s1[0], s2[1] - s1[1]);
    if (px < 4.6) return;
    const every = px < 9.5 ? 2 : 1;

    // A joint is a shadow in a groove: THIN, and never as black as a contour.
    const w = O.courseWidth * (1 - fog * 0.55);
    const strength = 0.42 * (1 - fog * 0.6);
    const pts = planeCoords(inst, f, origin, along, upDir);

    const k0 = Math.ceil((zLo + 1e-4) / H), k1 = Math.floor((zHi - 1e-4) / H);
    if (k1 - k0 > 260) return;
    for (let k = k0; k <= k1; k++) {
      if (every === 2 && (k & 1)) continue;
      const bb = bOf(k * H);
      const span = spanAt(pts, bb);
      if (!span) continue;

      // BROKEN, NOT RULED.  A joint drawn as one unbroken line from edge to edge
      // is the CAD tell — it is the single mark a hand never makes.  Piranesi's
      // joints fade in and out along their length, and the gaps are most of what
      // makes the stone read as stone rather than as a grid drawn on it.
      for (const [a0, a1] of brokenSpan(span[0], span[1], f.seed * 31 + k)) {
        this.strokeHatch(origin, along, upDir, a0, a1, bb, c,
          { width: w, strength, seed: k * 977 + f.seed, arc: hashs(f.seed, k, 7) * 0.006 * (a1 - a0) });
      }

      // Perpends, staggered half a block course to course — the bond.  Only on
      // near stonework, and only some of them: at any distance a wall reads as
      // horizontals with a few verticals implied.
      if (fog > 0.38 || px < 11) continue;
      const per = H * (spec.course === 'brick' ? 3.0 : 2.1);
      const off = (k % 2) * per * 0.5;
      const j0 = Math.ceil((span[0] - off) / per), j1 = Math.floor((span[1] - off) / per);
      for (let j = j0; j <= j1; j++) {
        const a = off + j * per;
        if (a <= span[0] + 1e-3 || a >= span[1] - 1e-3) continue;
        if (hashf(f.seed, k, j + 500) > 0.72) continue;     // not every one is drawn
        const bTop = bOf((k + 1) * H);
        this.strokeHatch(origin, upDir, along, Math.min(bb, bTop), Math.max(bb, bTop), a, c,
          { width: w * 0.8, strength: strength * 0.85, seed: (k * 31 + j) | 0, arc: 0 });
      }
    }
  }

  /**
   * Flagstones on a horizontal surface.
   *
   * Worth its own method rather than being folded into `course`, because a
   * paved floor is doing a completely different job in the picture.  A wall's
   * joints are texture; a FLOOR'S joints are the perspective — two families of
   * lines converging on the vanishing points are the strongest depth cue in a
   * Carceri and the reason you believe the hall is a hundred feet long.  They
   * run on the WORLD grid, at whole cell divisions, so the pattern is continuous
   * across every slab in the floor and the lattice never shows.
   */
  flags(inst, f, c, tone, fog, O) {
    if (f.n[2] < 0.75) return;                    // a soffit, not a floor
    const S = 0.5;                                // one flag is a metre square
    const cen = faceCentroid(inst, f);
    const s1 = projectWith(c, cen[0], cen[1], cen[2]);
    const s2 = projectWith(c, cen[0] + S, cen[1], cen[2]);
    const s3 = projectWith(c, cen[0], cen[1] + S, cen[2]);
    if (s1[2] <= 0 || s2[2] <= 0 || s3[2] <= 0) return;
    // Gate each family separately: a floor stretching to the horizon has legible
    // joints across it long after the joints along it have closed up.
    const pxX = Math.hypot(s2[0] - s1[0], s2[1] - s1[1]);
    const pxY = Math.hypot(s3[0] - s1[0], s3[1] - s1[1]);
    const origin = [0, 0, cen[2]];
    const w = O.courseWidth * (1 - fog * 0.5);
    const strength = 0.40 * (1 - fog * 0.55);

    for (const [dir, other, px, tag] of [
      [[1, 0, 0], [0, 1, 0], pxY, 0],
      [[0, 1, 0], [1, 0, 0], pxX, 1],
    ]) {
      if (px < 4.6) continue;
      const every = px < 9.5 ? 2 : 1;
      const pts = planeCoords(inst, f, origin, dir, other);
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
      const k0 = Math.ceil(lo / S), k1 = Math.floor(hi / S);
      if (k1 - k0 > 200) continue;
      for (let k = k0; k <= k1; k++) {
        if (every === 2 && (k & 1)) continue;
        const span = spanAt(pts, k * S);
        if (!span) continue;
        for (const [a0, a1] of brokenSpan(span[0], span[1], (k * 71 + tag * 13) | 0)) {
          this.strokeHatch(origin, dir, other, a0, a1, k * S, c,
            { width: w, strength, seed: (k * 313 + tag) | 0, arc: 0 });
        }
      }
    }
  }

  /** Timber grain: long strokes with the member, irregularly spaced. */
  grain(inst, f, c, O, fog) {
    if (fog > 0.6) return;
    const hd = f.hatchDir, n = f.n;
    const perp = norm(cross(n, hd));
    const p0 = inst.verts[f.v[0]];
    const d = p0[0] * n[0] + p0[1] * n[1] + p0[2] * n[2];
    const origin = [n[0] * d, n[1] * d, n[2] * d];
    const pts = f.v.map((i) => {
      const p = inst.verts[i];
      const q = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
      return [q[0] * hd[0] + q[1] * hd[1] + q[2] * hd[2], q[0] * perp[0] + q[1] * perp[1] + q[2] * perp[2]];
    });
    // Grain runs ALONG the baulk, which is the face's u, so hatch across b.
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
    const nLines = 5;
    for (let i = 1; i < nLines; i++) {
      const bb = lo + (hi - lo) * (i / nLines) + hashs(f.seed, i) * (hi - lo) * 0.06;
      const span = spanAt(pts, bb);
      if (!span) continue;
      this.strokeHatch(origin, hd, perp, span[0], span[1], bb, c,
        { width: O.courseWidth * 0.8, strength: 0.5, seed: f.seed * 7 + i, arc: hashs(f.seed, i, 3) * 0.02 * (span[1] - span[0]) });
    }
  }
}

/* ------------------------------------------------------------------ tables */

/**
 * The register ladder: how many layers of line, at what angles, at what spacing.
 *
 * This is the etcher's decision and the most consequential table in the repo.
 * Tone does not become "denser lines" continuously — it becomes MORE LAYERS,
 * each laid at an angle to the last, which is why an etching's darks have
 * texture and a halftone's do not.  Within a register the spacing tightens
 * smoothly so the steps between registers do not band.
 */
/**
 * THE REGISTER LADDER — the most consequential table in the repo, and the one
 * place where measurement beat intuition outright.
 *
 * The intuitive design, which this renderer shipped first, was: hold the stroke
 * thin, and make a passage darker by packing the lines closer and by adding
 * layers at angles chosen to avoid a right-angle cross.  It produced a plate
 * that read as woven mesh.
 *
 * Structure-tensor and autocorrelation measurements taken off high-resolution
 * museum scans of five Carceri plates across both editions say otherwise, and
 * they say it very clearly:
 *
 *   1. THE PITCH IS CONSTANT.  About 0.80 mm on a 545 mm plate, essentially
 *      flat across the whole tonal range.  Piranesi does not close the spacing
 *      to go dark.
 *   2. THE STROKE THICKENS.  Duty cycle — ink width over pitch — climbs from
 *      about 0.25 in the lights to 0.86 in the darks.  THAT is the tone knob.
 *      It is also what the plate physically is: the same needle-work bitten
 *      longer in acid opens wider.
 *   3. THE CROSS IS SQUARE.  The second family sits 88-96 degrees off the
 *      first, not the shallow 30-60 degrees of reproductive engraving.  The
 *      moire argument agrees: at 90 degrees the beat period is 0.71 of the
 *      pitch — finer than the hatching, therefore invisible — while a 20-degree
 *      cross beats at 2.9 pitches, which is exactly the visible mesh.
 *   4. THERE IS A DOMINANT PLATE-WIDE ANGLE: 40 degrees below horizontal,
 *      descending to the right, holding 53-66% of all oriented line energy.
 *      The hand has a stroke direction and it uses it nearly everywhere.
 *
 * (4) is a real correction to the "hatch describes the form" principle this
 * renderer was built on, so the two are reconciled rather than one discarded:
 * a face that has a FORM to describe — the intrados of a vault, the flank of a
 * drum, the grain of a baulk — keeps its own surface frame, because Piranesi
 * visibly wraps those.  Every flat face instead takes the in-plane direction
 * that PROJECTS closest to 40 degrees.  That direction depends on the camera,
 * which is exactly right: a plate is drawn for one view, and moving the camera
 * here is pulling a different plate.
 */
const D2R = Math.PI / 180;

/** Screen angles of the three families, measured with y DOWN, so a positive
 *  angle descends to the right — a backslash, as measured. */
const PRIMARY_DEG = 40;
const LAYERS = [
  { deg: PRIMARY_DEG, at: 0.045 },        // always, once past bare paper
  { deg: PRIMARY_DEG + 90, at: 0.50 },    // the square cross
  { deg: 88, at: 0.78 },                  // near-vertical, darkest register only
];

/**
 * How strongly each family is present at a given tone.
 *
 * A FAMILY FADES IN; IT DOES NOT SWITCH ON.  The first version of this had a
 * hard threshold, and the tone harness caught what the pictures could not: at
 * tone 0.44 one family ran at duty 0.44, and at tone 0.50 two families ran at
 * duty 0.29 each — so asking for a DARKER passage produced a LIGHTER plate, by
 * a tenth of the range, right in the middle of the tonal scale where every wall
 * in the building lives.  The transfer curve was not monotonic and nothing in
 * the image said so; it just looked like a decision somebody had made.
 */
const FAMILY_RAMP = 0.16;
function familyWeights(t, out) {
  for (let i = 0; i < LAYERS.length; i++) {
    const w = (t - LAYERS[i].at) / FAMILY_RAMP;
    out[i] = w < 0 ? 0 : w > 1 ? 1 : w;
  }
  return out;
}

/**
 * The common duty `d` such that families of duty d·wᵢ together cover
 * `coverage`:  1 − Π(1 − d·wᵢ) = coverage.
 *
 * Crossed families overlap, so two of duty d cover 2d − d², not 2d.  Getting
 * this wrong is why naive cross-hatching goes black the moment it crosses.
 * There is no closed form once the weights differ, so it is bisected — twenty
 * iterations of three multiplies, done once per tone step into a table.
 */
function solveDuty(coverage, w) {
  if (coverage <= 0) return 0;
  let lo = 0, hi = 0.985;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) * 0.5;
    let p = 1;
    for (let j = 0; j < w.length; j++) if (w[j] > 0) p *= 1 - m * w[j];
    if (1 - p < coverage) lo = m; else hi = m;
  }
  return (lo + hi) * 0.5;
}

/**
 * A drawn stroke does not deposit the ink its width implies.  It is tapered at
 * both ends, its ends are bitten back by a pixel or two to keep the hatch block
 * ragged, and it is laid at 95% strength — so the geometric duty over-promises.
 * MEASURED with tools/tonecheck.mjs, not derived: the whole point of that tool
 * is that every analytic estimate in this literature drifts.  Re-measure after
 * any change to the stroke rasteriser or the taper.
 */
const STROKE_EFFICIENCY = 0.84;

/** Per-render table: tone → per-family duty multiplier. */
function buildDutyTable() {
  const N = 128;
  const table = new Float32Array(N + 1);
  const w = new Float32Array(LAYERS.length);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    familyWeights(t, w);
    table[i] = solveDuty(Math.min(0.985, t / STROKE_EFFICIENCY), w);
  }
  return { table, N };
}

/** Break a joint into 1–3 drawn stretches with gaps.  See `course`. */
function brokenSpan(a0, a1, seed) {
  const L = a1 - a0;
  const r = hashf(seed, 3);
  if (r < 0.30) return [[a0 + L * 0.02, a1 - L * 0.02]];          // near enough whole
  const cuts = r < 0.72 ? 1 : 2;
  const out = [];
  let at = a0 + L * (0.01 + 0.05 * hashf(seed, 11));
  for (let i = 0; i <= cuts; i++) {
    const run = L * (0.20 + 0.42 * hashf(seed, 20 + i));
    const end = Math.min(a1 - L * 0.01, at + run);
    if (end - at > L * 0.10) out.push([at, end]);
    at = end + L * (0.035 + 0.075 * hashf(seed, 40 + i));
    if (at >= a1) break;
  }
  return out.length ? out : [[a0, a1]];
}

/** World-space centroid of a placed face. */
function faceCentroid(inst, f) {
  let x = 0, y = 0, z = 0;
  for (const i of f.v) { const p = inst.verts[i]; x += p[0]; y += p[1]; z += p[2]; }
  const k = 1 / f.v.length;
  return [x * k, y * k, z * k];
}

/**
 * The direction lying IN a face's plane whose screen projection runs at
 * `deg` below the horizontal (y down, so positive descends to the right).
 *
 * Any in-plane direction is a·u + b·v, and projection is linear in a
 * neighbourhood, so project one small step of u and one of v and solve for the
 * combination parallel to the wanted screen vector.  Returns null when the face
 * is too edge-on for the answer to mean anything, and the caller falls back to
 * the surface's own frame.
 */
function inPlaneAtScreenAngle(inst, f, c, deg) {
  const o = faceCentroid(inst, f);
  const s0 = projectWith(c, o[0], o[1], o[2]);
  if (s0[2] <= 0) return null;
  const e = 0.05;
  const U = f.uW || f.hatchDir;
  const V = f.vW || norm(cross(f.n, U));
  const su = projectWith(c, o[0] + U[0] * e, o[1] + U[1] * e, o[2] + U[2] * e);
  const sv = projectWith(c, o[0] + V[0] * e, o[1] + V[1] * e, o[2] + V[2] * e);
  if (su[2] <= 0 || sv[2] <= 0) return null;
  const pux = su[0] - s0[0], puy = su[1] - s0[1];
  const pvx = sv[0] - s0[0], pvy = sv[1] - s0[1];
  const th = deg * D2R, ct = Math.cos(th), st = Math.sin(th);
  // Cross product of (a·pu + b·pv) with (ct, st) set to zero.
  const a = -(pvx * st - pvy * ct);
  const b = (pux * st - puy * ct);
  if (Math.abs(a) + Math.abs(b) < 1e-9) return null;
  const d = norm([U[0] * a + V[0] * b, U[1] * a + V[1] * b, U[2] * a + V[2] * b]);
  return isFinite(d[0]) ? d : null;
}

/** A face's vertices in the (a,b) coordinates of a given in-plane frame. */
function planeCoords(inst, f, origin, aDir, bDir) {
  return f.v.map((i) => {
    const p = inst.verts[i];
    const q = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    return [
      q[0] * aDir[0] + q[1] * aDir[1] + q[2] * aDir[2],
      q[0] * bDir[0] + q[1] * bDir[1] + q[2] * bDir[2],
    ];
  });
}

/** The a-interval of a convex polygon (in (a,b) coords) at height b. */
function spanAt(poly, b) {
  let lo = Infinity, hi = -Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    if ((p[1] <= b && q[1] > b) || (q[1] <= b && p[1] > b)) {
      const a = p[0] + (q[0] - p[0]) * (b - p[1]) / (q[1] - p[1]);
      if (a < lo) lo = a;
      if (a > hi) hi = a;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Push a polyline's two ends out along their own direction. */
function extend(pts, by) {
  const n = pts.length;
  const ax = pts[0] - pts[2], ay = pts[1] - pts[3];
  const al = Math.hypot(ax, ay) || 1;
  pts[0] += ax / al * by; pts[1] += ay / al * by;
  const bx = pts[n - 2] - pts[n - 4], by2 = pts[n - 1] - pts[n - 3];
  const bl = Math.hypot(bx, by2) || 1;
  pts[n - 2] += bx / bl * by; pts[n - 1] += by2 / bl * by;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Number(process.hrtime.bigint() / 1000n) / 1000);
