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
import { projectWith, hashf, hashs, norm, cross, sub } from './math.js';
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
const SKY_W = 0.46;
const KEY_W = 0.42;
const AMBIENT = 0.12;

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
const SKY_STEP = 0.62;

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
  const occ = world.occupancy;
  for (const [dx, dy, dz, wgt] of SKY_RAYS) {
    const face = dx * n[0] + dy * n[1] + dz * n[2];
    if (face <= 0.02) continue;                 // the ray is behind the surface
    const w = wgt * face;
    total += w;
    let blocked = false;
    for (let t = 0.35; t < SKY_REACH; t += SKY_STEP) {
      const k = `${Math.floor(p[0] + n[0] * 0.02 + dx * t)},${Math.floor(p[1] + n[1] * 0.02 + dy * t)},${Math.floor(p[2] + n[2] * 0.02 + dz * t)}`;
      const hit = occ.get(k);
      if (hit !== undefined && hit !== self) { blocked = true; break; }
    }
    if (!blocked) seen += w;
  }
  return total > 0 ? seen / total : 0;
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
  return pts.map((p) => ({ p, sky: skyVisibility(world, p, f.n, self) }));
}

/** Inverse-distance blend of a face's sky samples at an arbitrary point. */
function skyAt(samples, p) {
  if (samples.length === 1) return samples[0].sky;
  let num = 0, den = 0;
  for (const s of samples) {
    const dx = p[0] - s.p[0], dy = p[1] - s.p[1], dz = p[2] - s.p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < 1e-6) return s.sky;
    const w = 1 / d;
    num += s.sky * w; den += w;
  }
  return num / den;
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
function faceTone(n, mat, fog, sky) {
  const key = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2]);
  // The key is a beam of light: it cannot reach a surface the sky cannot reach.
  const lum = SKY_W * sky + KEY_W * key * (0.25 + 0.75 * sky) + AMBIENT * sky;
  let t = 1 - lum;
  t += MATERIALS[mat] ? MATERIALS[mat].tone : 0;

  // Contrast about a pivot below the middle — the darks are the subject.
  const P = 0.44, K = 2.35;
  t = t < P ? P * Math.pow(Math.max(0, t) / P, K) : 1 - (1 - P) * Math.pow((1 - t) / (1 - P), K);

  // Aerial perspective.  In a pure line medium this is not haze, it is the
  // etcher simply putting fewer and finer lines into the distance; the far
  // arcade of Plate VII is almost bare paper.  So distance pulls tone DOWN.
  t *= 1 - fog * 0.78;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/* --------------------------------------------------------- face gathering */

function instances(world, catalog) {
  const out = [];
  let faceId = 0;
  for (const b of world.blocks.values()) {
    const def = catalog.get(b.id);
    if (!def) continue;
    const [ax, ay] = def.size;
    const turn = turnY(b.rot, ax, ay);
    const move = translate(b.x, b.y, b.z);
    const xf = (p) => move(turn(p));
    const mesh = def.mesh;

    const verts = mesh.verts.map(xf);
    const faces = mesh.faces.map((f) => {
      const rot = (d) => {
        const a = xf([0, 0, 0]), q = xf(d);
        return [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      };
      return {
        v: f.v, mat: f.mat, tag: f.tag, side: f.side, tone: f.tone,
        n: rot(f.n), hatchDir: rot(f.hatchDir),
        id: faceId++,
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
  return out;
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
  return [dx * c.rx + dy * c.ry, dz, dx * c.fx + dy * c.fy];
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
  /** Screen spacing, in output pixels, that the sparsest hatch layer aims for.
   *  Below about 2.6 the registers stop being distinguishable at all; above
   *  about 4 the plate reads as a wireframe with stripes on it. */
  hatchTarget: 3.2,
  /** Bare paper below this tone.  Piranesi leaves a LOT of paper — a lit pier
   *  in Plate VII carries its contour and a few joints and nothing else. */
  paperBelow: 0.125,
  hatchWidth: 0.78,
  creaseWidth: 1.15,
  silhouetteWidth: 1.9,
  courseWidth: 0.72,
  /** Distance, in cells, at which aerial perspective is fully applied. */
  fogDepth: 46,
  /** Cap on hatch lines per face — a runaway wall must degrade, not hang. */
  maxLinesPerFace: 420,
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
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return this;
    this.plate = new Plate(width, height, this.ss);
    this.depth = new Depth(width, height);
    this.width = width; this.height = height;
    return this;
  }

  render(world, camera, catalog, opts = {}) {
    const O = { ...DEFAULTS, ...opts };
    const t0 = now();
    camera.setFraming({ width: this.width, height: this.height });
    const c = camera.snapshot();
    this.plate.clear();
    this.depth.clear();

    const insts = instances(world, catalog);
    const cancelled = cancelCoincident(insts);

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
          f.n[0] * c.rx + f.n[1] * c.ry,
          f.n[2],
          f.n[0] * c.fx + f.n[1] * c.fy,
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
    const tStencil = now();

    /* ---- 4 & 5 & 6 ------------------------------------------------------- */
    let hatchLines = 0;
    if (O.hatching || O.coursing) {
      for (const { inst, f } of draw) {
        const fog = clamp01(f.zavg / O.fogDepth);
        // Must match world.js's anchor key exactly, or every ray is blocked by
        // the block it started from and the whole world renders black.
        const self = `${inst.block.layer || 'structure'}|${inst.block.x},${inst.block.y},${inst.block.z}`;
        f.skySamples = O.sky === false
          ? [{ p: faceCentroid(inst, f), sky: 0.62 }]
          : skyProfile(world, inst, f, self);
        let mean = 0;
        for (const s of f.skySamples) mean += s.sky / f.skySamples.length;
        f.toneValue = faceTone(f.n, f.mat, fog, mean) + (f.tone || 0);
        f.toneAt = (p) => clamp01(faceTone(f.n, f.mat, fog, skyAt(f.skySamples, p)) + (f.tone || 0));
        if (O.hatching) hatchLines += this.hatch(inst, f, c, f.toneValue, fog, O);
        if (O.coursing) this.course(inst, f, c, f.toneValue, fog, O);
      }
    }
    const tTone = now();
    if (O.lines) this.lineWork(insts, c, O);
    const tLines = now();

    return {
      faces: draw.length, cancelled, hatchLines,
      ms: { stencil: tStencil - t0, tone: tTone - tStencil, lines: tLines - tTone, total: tLines - t0 },
      ink: this.plate.meanInk(),
    };
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
  lineWork(insts, c, O) {
    const P = this.plate, ss = this.ss;
    for (const inst of insts) {
      const eye = [c.ex, c.ey, c.ez];
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
        this.strokeWorldEdge(a, b, c, {
          width: (heavy ? O.silhouetteWidth : O.creaseWidth),
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
    const zmid = 2 / (A[2] + B[2]);
    const wgt = opt.width * clamp(1.25 - zmid / (opt.O.fogDepth * 1.4), 0.34, 1.25);

    let run = null;
    const flush = () => {
      if (run && run.length >= 4) {
        // Overshoot: an etched line runs past its corner more often than it
        // stops short of it.  Without this every junction is a mitred box and
        // the drawing looks like CAD.
        const over = 0.55 + hashf(opt.seed, 11) * 1.9;
        extend(run, over * ss);
        P.stroke(run, wgt * ss, opt.kind === 'silhouette' ? 0.97 : 0.9, 0.42);
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

    const n = f.n, hd = f.hatchDir;
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

    let spacing = 0.0625;                          // 12.5 cm — the finest register
    let guard = 0;
    while (spacing * pxPerUnit < O.hatchTarget && guard++ < 24) spacing *= 2;
    while (spacing * pxPerUnit > O.hatchTarget * 2 && guard++ < 24) spacing *= 0.5;

    let tMax = 0;
    for (const s of f.skySamples) tMax = Math.max(tMax, f.toneAt(s.p));
    let count = 0;
    for (let li = 0; li < LAYERS.length; li++) {
      const L = LAYERS[li];
      if (tMax <= L.th) break;
      // Later layers cross at a shallow angle.  Never 90°: a right-angle cross
      // reads as woven cloth and moirés against the pixel grid.  Etchers cross
      // at something like 30–60° and so do we.
      const ang = L.ang;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const hd2 = [hd[0] * ca + perp[0] * sa, hd[1] * ca + perp[1] * sa, hd[2] * ca + perp[2] * sa];
      const pp2 = [-hd[0] * sa + perp[0] * ca, -hd[1] * sa + perp[1] * ca, -hd[2] * sa + perp[2] * ca];
      const sp = spacing * L.mul;

      // Re-express the polygon for this layer's direction.
      const q = pts.map(([a, b]) => [a * ca + b * sa, -a * sa + b * ca]);
      let lo = Infinity, hi = -Infinity;
      for (const p of q) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
      const k0 = Math.ceil(lo / sp), k1 = Math.floor(hi / sp);
      if (k1 - k0 > O.maxLinesPerFace) continue;

      for (let k = k0; k <= k1; k++) {
        const bb = k * sp;
        const span = spanAt(q, bb);
        if (!span) continue;
        let [a0, a1] = span;
        if (a1 - a0 < sp * 0.35) continue;          // a nub, not a stroke

        // --- how dark is it JUST HERE? ------------------------------------
        // Every line asks the face's own light profile where it lies, so a
        // register fades in across a surface instead of switching on all at
        // once.  This is the difference between a wall that is lit and a wall
        // that is filled: the light falls off along it and the hatching
        // thins out with it.
        const am = (a0 + a1) / 2;
        const mid = [
          origin[0] + hd2[0] * am + pp2[0] * bb,
          origin[1] + hd2[1] * am + pp2[1] * bb,
          origin[2] + hd2[2] * am + pp2[2] * bb,
        ];
        const tLoc = f.toneAt(mid);
        const density = clamp01((tLoc - L.th) / (L.next - L.th));
        if (density <= 0.001) continue;
        // Thin the layer by DROPPING LINES from a dense set, not by spreading
        // them: the golden-ratio sequence spaces the survivors evenly, so a
        // half-density passage looks like a wider hatch rather than a gappy
        // one, and no two adjacent lines ever vanish together.
        if (density < 0.999 && frac(k * 0.6180339887498949 + li * 0.37) >= density) continue;

        // The hand, part two.  Strokes do not all begin and end on the same
        // line: an etcher's hatch block has a ragged edge, and the raggedness
        // is most of what distinguishes drawn tone from a fill pattern.
        const bite = (a1 - a0);
        a0 += bite * 0.07 * hashf(f.id, k, li);
        a1 -= bite * 0.07 * hashf(f.id, k, li + 97);
        if (a1 <= a0) continue;

        this.strokeHatch(origin, hd2, pp2, a0, a1, bb, c, {
          width: O.hatchWidth * L.w * (1 - fog * 0.34),
          strength: L.s,
          seed: (f.id * 131 + k * 7 + li) | 0,
          arc: (hashs(f.id, k, li + 41)) * 0.010 * (a1 - a0),
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
      if (run && run.length >= 4) P.stroke(run, opt.width * ss, opt.strength, 0.7);
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
    if (Math.abs(f.n[2]) > 0.75) return;         // a paved floor, not a wall face
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
      for (const [a0, a1] of brokenSpan(span[0], span[1], f.id * 31 + k)) {
        this.strokeHatch(origin, along, upDir, a0, a1, bb, c,
          { width: w, strength, seed: k * 977 + f.id, arc: hashs(f.id, k, 7) * 0.006 * (a1 - a0) });
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
        if (hashf(f.id, k, j + 500) > 0.72) continue;     // not every one is drawn
        const bTop = bOf((k + 1) * H);
        this.strokeHatch(origin, upDir, along, Math.min(bb, bTop), Math.max(bb, bTop), a, c,
          { width: w * 0.8, strength: strength * 0.85, seed: (k * 31 + j) | 0, arc: 0 });
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
      const bb = lo + (hi - lo) * (i / nLines) + hashs(f.id, i) * (hi - lo) * 0.06;
      const span = spanAt(pts, bb);
      if (!span) continue;
      this.strokeHatch(origin, hd, perp, span[0], span[1], bb, c,
        { width: O.courseWidth * 0.8, strength: 0.5, seed: f.id * 7 + i, arc: hashs(f.id, i, 3) * 0.02 * (span[1] - span[0]) });
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
 * THE REGISTER LADDER — the most consequential table in the repo.
 *
 * Tone does not become "denser lines" continuously.  It becomes MORE LAYERS,
 * each laid at an angle to the last, which is why an etching's darks have
 * texture and a halftone's do not.  Each layer holds a fixed spacing and comes
 * in by having more and more of its lines actually drawn, from `th` to `next` —
 * so a register fades in over a passage instead of switching on at a contour.
 *
 * The angles are not a spread of the circle.  A layer crossing its predecessor
 * at 90° reads as woven cloth and beats against the pixel grid; etchers cross at
 * something like 30–60°, and the fourth layer here comes back close to the first
 * (20°) because that is what you do when you simply need more black.
 */
const D2R = Math.PI / 180;
const LAYERS = [
  { ang: 0 * D2R, mul: 0.98, w: 1.00, s: 0.90, th: 0.10, next: 0.34 },
  { ang: 54 * D2R, mul: 1.02, w: 0.90, s: 0.84, th: 0.32, next: 0.58 },
  { ang: -34 * D2R, mul: 1.00, w: 0.86, s: 0.80, th: 0.56, next: 0.80 },
  { ang: 20 * D2R, mul: 0.62, w: 0.86, s: 0.86, th: 0.78, next: 0.93 },
  { ang: -68 * D2R, mul: 0.55, w: 0.92, s: 0.92, th: 0.90, next: 1.04 },
];

const frac = (v) => v - Math.floor(v);

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
