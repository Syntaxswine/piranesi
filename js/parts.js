// parts.js - the SUB-BLOCKS.
//
// The player never touches anything in this file.  These are the elements a
// main block is procedurally assembled from: a pier, a flight of stairs, an
// arch, a gantry, a corbelled balcony, a hanging chain.  Think of them as the
// functions; a main block is a program written in them.
//
// WHY GENERATE MAIN BLOCKS AT ALL, instead of drawing them by hand?  Because of
// what a Piranesi block has to be.  It is not a wall segment or a floor tile —
// it is over the top, imposing, and not remotely practical, and a single cube
// may carry a tower AND a staircase AND an archway that do not agree with one
// another.  Hand-authoring enough of those to keep a builder interesting is
// weeks of work and the results would still repeat.  Composing them from a
// dozen parts gives an endless catalogue out of a small kit — which is also
// exactly how the sixteen Carceri plates were made: a small motif kit, reused
// densely.
//
// UNITS.  Everything here is in SUB-CELLS.  A main block is SUB x SUB x SUB
// sub-cells (see compose.js); a sub-cell is 1.5 m, so a main block is 12 m and
// a man is a little over one sub-cell tall.  Parts take sub-cell coordinates
// and are free to sit anywhere, including off-axis and overhanging — nothing
// here checks whether a thing could stand up.  That is deliberate.

import { box, arc, lathe, strut } from './mesh.js';

/* --------------------------------------------------------------- masonry -- */

/** A rectangular mass of stone, optionally with a cornice course on top. */
export function pier(m, o) {
  const { x0, y0, z0, x1, y1, z1 } = o;
  const mat = o.mat || 'rustic';
  const capH = o.cornice ? Math.min(0.5, (z1 - z0) * 0.18) : 0;
  box(m, [x0, y0, z0], [x1, y1, z1 - capH], { mat, tag: 'pier' });
  if (capH > 0) {
    const p = 0.22;
    box(m, [x0 - p, y0 - p, z1 - capH], [x1 + p, y1 + p, z1 - capH * 0.45], { mat: 'stone', tag: 'corona' });
    box(m, [x0 - p * 0.4, y0 - p * 0.4, z1 - capH * 0.45], [x1 + p * 0.4, y1 + p * 0.4, z1], { mat: 'stone', tag: 'cyma' });
  }
  return m;
}

/** A flat slab: a floor, a landing, the deck of a bridge. */
export function slab(m, o) {
  const t = o.t ?? 0.34;
  box(m, [o.x0, o.y0, o.z], [o.x1, o.y1, o.z + t], {
    mat: o.mat || 'stone', tag: o.tag || 'slab', hatchTop: 'u',
  });
  return m;
}

/**
 * A void through a mass: the arch, and the single most useful part here.
 *
 * `axis` is the direction you walk THROUGH it.  The section is a rectangle with
 * a semicircular bite, decomposed into vertical strips with shared vertices —
 * shared because the edge table keys on vertex index, and allocating fresh ones
 * per strip rules a line down every strip and turns a smooth arch into a paling
 * fence.
 */
export function archway(m, o) {
  const { x0, x1, y0, y1, z0, z1 } = o;
  const axis = o.axis || 'y';
  const mat = o.mat || 'stone';
  const soffit = o.soffit || 'plaster';
  // Across-the-opening extent, and the depth you walk through.
  const [a0, a1, b0, b1] = axis === 'y' ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
  const span = a1 - a0, r = span / 2;
  const rise = Math.min(r, (z1 - z0) * 0.72);
  const N = Math.max(10, Math.round(span * 4));

  const at = (a, b, z) => (axis === 'y' ? [a, b, z] : [b, a, z]);
  const arcZ = (a) => {
    const d = (a - (a0 + r)) / r;
    return Math.abs(d) >= 1 ? z0 : z0 + rise * Math.sqrt(Math.max(0, 1 - d * d));
  };

  const as = [];
  for (let i = 0; i <= N; i++) as.push(a0 + (span * i) / N);
  const lo = as.map(arcZ);
  const A = [], B = [], TA = [], TB = [];
  for (let i = 0; i <= N; i++) {
    A.push(m.vert(at(as[i], b0, lo[i])));
    B.push(m.vert(at(as[i], b1, lo[i])));
    TA.push(m.vert(at(as[i], b0, z1)));
    TB.push(m.vert(at(as[i], b1, z1)));
  }
  const uA = axis === 'y' ? [1, 0, 0] : [0, 1, 0];
  const uB = axis === 'y' ? [0, 1, 0] : [1, 0, 0];

  for (let i = 0; i < N; i++) {
    // the two faces of the wall
    m.face([A[i], A[i + 1], TA[i + 1], TA[i]], { mat, u: uA, vDir: [0, 0, 1], hatch: 'v', tag: 'spandrel' });
    m.face([TB[i], TB[i + 1], B[i + 1], B[i]], { mat, u: uA, vDir: [0, 0, 1], hatch: 'v', tag: 'spandrel' });
    // the intrados: the strokes wrap the barrel, so it keeps its own frame
    const da = as[i + 1] - as[i], dz = lo[i + 1] - lo[i];
    const L = Math.hypot(da, dz) || 1;
    m.face([A[i], B[i], B[i + 1], A[i + 1]], {
      mat: soffit, u: uB, vDir: at(da / L, 0, dz / L), hatch: 'v', tag: 'intrados', form: true,
    });
  }
  // ends and top
  m.face([TA[0], TB[0], B[0], A[0]], { mat, u: uB, vDir: [0, 0, 1], hatch: 'v', tag: 'jamb' });
  m.face([A[N], B[N], TB[N], TA[N]], { mat, u: uB, vDir: [0, 0, 1], hatch: 'v', tag: 'jamb' });
  for (let i = 0; i < N; i++) {
    m.face([TA[i], TA[i + 1], TB[i + 1], TB[i]], { mat, u: uA, vDir: uB, hatch: 'u', tag: 'extrados' });
  }
  return m;
}

/* ------------------------------------------------------------ circulation - */

/**
 * A flight of steps.  `dir` is one of +x -x +y -y and is the direction of
 * ASCENT; the flight rises `z1 - z0` over its own run, so a short run makes a
 * steep flight, which the Carceri are full of.
 */
export function stair(m, o) {
  const { z0, z1 } = o;
  const dir = o.dir || '+y';
  const mat = o.mat || 'stone';
  const along = dir[1];                       // 'x' | 'y'
  const sign = dir[0] === '+' ? 1 : -1;
  const [p0, p1] = along === 'y' ? [o.y0, o.y1] : [o.x0, o.x1];
  const run = p1 - p0, rise = z1 - z0;
  const N = Math.max(4, Math.round(rise * 3.2));
  for (let i = 0; i < N; i++) {
    const f = i / N, g = (i + 1) / N;
    // Each tread is a box reaching back to the high end, so the flight is a
    // solid wedge rather than a row of floating slabs.
    const lo = sign > 0 ? p0 + run * f : p0;
    const hi = sign > 0 ? p1 : p1 - run * f;
    const zt = z0 + rise * g;
    if (along === 'y') box(m, [o.x0, lo, z0], [o.x1, hi, zt], { mat, tag: 'tread', skip: i ? [sign > 0 ? '-y' : '+y'] : [] });
    else box(m, [lo, o.y0, z0], [hi, o.y1, zt], { mat, tag: 'tread', skip: i ? [sign > 0 ? '-x' : '+x'] : [] });
  }
  return m;
}

/** Timber planks on bearers: a catwalk, hung wherever it likes. */
export function catwalk(m, o) {
  const along = (o.x1 - o.x0) >= (o.y1 - o.y0) ? 'x' : 'y';
  const w = along === 'x' ? o.y1 - o.y0 : o.x1 - o.x0;
  const n = Math.max(2, Math.round(w * 2.2));
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 0.82) / n;
    if (along === 'x') box(m, [o.x0, o.y0 + w * a, o.z + 0.1], [o.x1, o.y0 + w * b, o.z + 0.2], { mat: 'timber', tag: 'plank', hatchTop: 'u' });
    else box(m, [o.x0 + w * a, o.y0, o.z + 0.1], [o.x0 + w * b, o.y1, o.z + 0.2], { mat: 'timber', tag: 'plank', hatchTop: 'u' });
  }
  if (along === 'x') {
    box(m, [o.x0, o.y0, o.z], [o.x1, o.y0 + 0.16, o.z + 0.1], { mat: 'timber', tag: 'bearer' });
    box(m, [o.x0, o.y1 - 0.16, o.z], [o.x1, o.y1, o.z + 0.1], { mat: 'timber', tag: 'bearer' });
  } else {
    box(m, [o.x0, o.y0, o.z], [o.x0 + 0.16, o.y1, o.z + 0.1], { mat: 'timber', tag: 'bearer' });
    box(m, [o.x1 - 0.16, o.y0, o.z], [o.x1, o.y1, o.z + 0.1], { mat: 'timber', tag: 'bearer' });
  }
  return m;
}

/** Balusters and a coping along one edge of a deck. */
export function balustrade(m, o) {
  const along = (o.x1 - o.x0) >= (o.y1 - o.y0) ? 'x' : 'y';
  const len = along === 'x' ? o.x1 - o.x0 : o.y1 - o.y0;
  const n = Math.max(2, Math.round(len * 1.6));
  const H = o.h ?? 0.78;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cx = along === 'x' ? o.x0 + len * t : (o.x0 + o.x1) / 2;
    const cy = along === 'y' ? o.y0 + len * t : (o.y0 + o.y1) / 2;
    lathe(m, cx, cy, [[0.09, 0.06], [0.12, 0.16], [0.07, H * 0.55], [0.13, H * 0.74], [0.08, H * 0.86]], 8,
      { mat: 'stone', tag: 'baluster', capTop: false });
  }
  box(m, [o.x0, o.y0, o.z + H * 0.86], [o.x1, o.y1, o.z + H], { mat: 'stone', tag: 'coping' });
  box(m, [o.x0, o.y0, o.z], [o.x1, o.y1, o.z + 0.09], { mat: 'stone', tag: 'plinth' });
  return m;
}

/* ----------------------------------------------------------------- round -- */

/** A drum: a round tower, a well head, a turret. */
export function drum(m, o) {
  const prof = o.profile || [[o.r, o.z0], [o.r, o.z1]];
  lathe(m, o.cx, o.cy, prof, o.seg || 20, { mat: o.mat || 'rustic', tag: 'drum', capTop: o.capTop !== false, hatch: 'v' });
  return m;
}

/** A turret cap: a low cone on a corbelled ring. */
export function turret(m, o) {
  drum(m, { cx: o.cx, cy: o.cy, r: o.r, z0: o.z0, z1: o.z0 + 0.3, seg: 16, capTop: false });
  drum(m, { cx: o.cx, cy: o.cy, r: o.r * 1.18, z0: o.z0 + 0.3, z1: o.z0 + 0.55, seg: 16, capTop: false, mat: 'stone' });
  lathe(m, o.cx, o.cy, [[o.r * 1.1, o.z0 + 0.55], [0.02, o.z0 + 0.55 + (o.h ?? 1.6)]], 16,
    { mat: 'stone', tag: 'cone', capTop: false, hatch: 'v' });
  return m;
}

/* ----------------------------------------------------------- timber, iron - */

/** A braced post: the scaffolding that holds up the impossible parts. */
export function gantry(m, o) {
  const r = o.r ?? 0.16;
  box(m, [o.cx - r, o.cy - r, o.z0], [o.cx + r, o.cy + r, o.z1], { mat: 'timber', tag: 'post' });
  const head = o.z1 - Math.min(1.4, (o.z1 - o.z0) * 0.4);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    strut(m, [o.cx + dx * r, o.cy + dy * r, head], [o.cx + dx * (r + 1.1), o.cy + dy * (r + 1.1), o.z1 - 0.2], r * 0.7, { tag: 'brace' });
  }
  return m;
}

/** A great baulk crossing the space, with iron straps. */
export function beam(m, o) {
  strut(m, [o.x0, o.y0, o.z0], [o.x1, o.y1, o.z1], o.r ?? 0.24, { tag: 'baulk', mat: 'timber' });
  return m;
}

/** A chain hanging from a ring.  It swags, because chains do. */
export function chain(m, o) {
  const links = Math.max(3, Math.round((o.z0 - o.z1) * 2.4));
  for (let i = 0; i < links; i++) {
    const t = i / links;
    const z = o.z0 - (o.z0 - o.z1) * t;
    const sag = Math.sin(t * Math.PI) * (o.sag ?? 0);
    const r = 0.075;
    box(m, [o.cx - r + sag, o.cy - r, z - 0.24], [o.cx + r + sag, o.cy + r, z], { mat: 'iron', tag: 'link' });
  }
  return m;
}

/** A ring bolted to a wall. */
export function ring(m, o) {
  const R = o.r ?? 0.22;
  const seg = 12;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a) => [o.cx + Math.cos(a) * R, o.cy, o.z + Math.sin(a) * R];
    const q = (a) => [o.cx + Math.cos(a) * R * 0.68, o.cy, o.z + Math.sin(a) * R * 0.68];
    m.face([m.vert(p(a0)), m.vert(p(a1)), m.vert(q(a1)), m.vert(q(a0))],
      { mat: 'iron', u: [1, 0, 0], vDir: [0, 0, 1], hatch: 'u', tag: 'ring' });
  }
  return m;
}

/** A hanging lantern - the only light the eye can find. */
export function lamp(m, o) {
  box(m, [o.cx - 0.04, o.cy - 0.04, o.z], [o.cx + 0.04, o.cy + 0.04, o.z + o.drop], { mat: 'iron', tag: 'stem' });
  lathe(m, o.cx, o.cy, [[0.03, o.z], [0.26, o.z + 0.16], [0.30, o.z + 0.5], [0.05, o.z + 0.62]], 8,
    { mat: 'iron', tag: 'lantern', hatch: 'v' });
  return m;
}

/** A barred opening. */
export function grating(m, o) {
  const n = o.bars ?? 4;
  const w = o.x1 - o.x0;
  for (let i = 1; i < n; i++) {
    const x = o.x0 + (w * i) / n;
    box(m, [x - 0.05, o.y - 0.05, o.z0], [x + 0.05, o.y + 0.05, o.z1], { mat: 'iron', tag: 'bar' });
  }
  const h = o.z1 - o.z0;
  for (let j = 1; j < 3; j++) {
    const z = o.z0 + (h * j) / 3;
    box(m, [o.x0, o.y - 0.04, z - 0.04], [o.x1, o.y + 0.04, z + 0.04], { mat: 'iron', tag: 'bar' });
  }
  return m;
}

/** A corbel: a bracket that lets a balcony hang off nothing. */
export function corbel(m, o) {
  const s = o.out ?? 0.6;
  for (let i = 0; i < 3; i++) {
    const f = i / 3;
    box(m, [o.cx - 0.3 + f * 0.06, o.cy, o.z + f * 0.22],
      [o.cx + 0.3 - f * 0.06, o.cy + s * (1 - f * 0.55), o.z + (f + 1) * 0.22], { mat: 'stone', tag: 'corbel' });
  }
  return m;
}
