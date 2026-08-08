// drawn.js — THE THIRD FAMILY: the block you drew yourself.
//
// `S:` is a stack of NAMED plans and `A:` is an arch on a named pier, and
// between them they enumerate to sixty-six thousand blocks — every one of which
// the GRAMMAR chose.  That is the right way round for a vocabulary and the wrong
// way round for a design: when you want one specific piece, "which of the
// twenty-four plans is nearest?" is the wrong question.
//
//   "can you make a block builder so i can design specific blocks?  something
//    with 3 layers, these slices, and a ramp tool.  something where i fill in
//    the grid with a bucket tool for each of the three layers."
//
// So: `D:` — a block whose three layers are painted, cell by cell, on HIS OWN
// SLICE GRID.  Four things make that safe rather than a hole in the cube law.
//
// 1. THE GRID IS THE PLANES.  A cell of the drawing board is the gap between two
//    adjacent slice planes, so every edge of every painted shape lands on one by
//    construction.  You cannot draw an illegal block; there is nowhere illegal
//    to put the pen.  And when the ladder is simplified — see the handoff §6.1,
//    R = 2 and 2.5/6.5 dropped — the board regenerates from PLANES and gets
//    coarser on its own.  Nothing here names a number.
//
// 2. THE PIECES ARE A PARTITION, NOT A UNION.  A painted region is cut into
//    disjoint maximal rectangles before it becomes a plan.  §2.3 of the handoff:
//    two overlapping polygons are crossed twice by the solidity ray and the
//    overlap reads as VOID.  A partition cannot overlap, so the commonest way to
//    draw a broken block is unreachable — and `decode` refuses one anyway, in
//    case a recipe arrives from somewhere that never went through the board.
//
// 3. IT RAISES STONE WITH `extrudePlan`, the same call `stack.js` makes.  A
//    drawn `full` and `S:full,full,full` are the same block, not two blocks that
//    resemble each other — and there is a test that says so.
//
// 4. THE RECIPE IS THE IDENTITY, in half-yards, base 36.  Not cell indices: cell
//    indices are positions in a list that PLANES regenerates, which is exactly
//    the bug recipe.js exists to kill.  `9` is 18 half-yards is `i`, so every
//    coordinate in the game is one character and a rectangle is four.
//
// THE RAMP is the one genuinely new solid in the game, and it is his rule:
//
//   "each layer up is 3 yards, so it requires at least 3 yards of floorspace
//    for the ramp up one level."
//
// A wedge, rising one STOREY over a run of at least one STOREY — so the steepest
// ramp the game allows is 45°, and a longer run is a gentler one.  It belongs to
// the layer it climbs, which is what makes "at least 3 yards" a statement the
// grammar can check rather than a note in a document.

import { Mesh } from './mesh.js';
import { SUB, PLANES, DECKS, STOREY } from './cube.js';
import { rect, extrudePlan } from './plan.js';
import { tagFlat } from './forms.js';

const S = SUB;

/* ------------------------------------------------------------- the board -- */

/** The slice lines, in yards.  THE BOARD IS THE PLANES — it is not a grid that
 *  happens to agree with them. */
export const SLICES = PLANES;
/** Cells across the board: eight, of unequal width, and that is correct.  The
 *  half-yard cells between 2 and 3 are narrow because his drawing puts two
 *  lines there. */
export const N = SLICES.length - 1;
/** Layers in a drawn block — the same three storeys a stack has.  Derived from
 *  the decks rather than written down again; test/drawn.test.mjs pins it to
 *  recipe.js's LAYERS so the two families can never disagree about what a block
 *  is. */
export const LAYERS = DECKS.length - 1;
/** One layer up.  A ramp's rise, and the minimum for its run. */
export const RISE = STOREY;
/** The uphill direction of a ramp: e = +x, n = +y, w = -x, s = -y. */
export const DIRS = ['e', 'n', 'w', 's'];

/** Cell (i,j) → its square in yards, [x0,y0,x1,y1]. */
export const cellBox = (i, j) => [SLICES[i], SLICES[j], SLICES[i + 1], SLICES[j + 1]];
export const idx = (i, j) => i + N * j;

/** Which slice plane is this?  Exact, with a tolerance — a coordinate that is
 *  nearly on a plane is off the grid, and saying so is the whole job. */
export function planeIndex(v, eps = 1e-6) {
  for (let i = 0; i < SLICES.length; i++) if (Math.abs(SLICES[i] - v) < eps) return i;
  return -1;
}

/** An empty drawing: three blank layers. */
export function blank(mat = 'stone') {
  return {
    mat,
    layers: Array.from({ length: LAYERS }, () => ({ cells: new Uint8Array(N * N), ramps: [] })),
  };
}

/* -------------------------------------------------------- the partition -- */

/**
 * PAINTED CELLS → DISJOINT MAXIMAL RECTANGLES.
 *
 * Greedy: take the first unclaimed filled cell, run right as far as the fill
 * goes, then run down as far as the whole width stays filled, claim the block
 * and repeat.  It is not the minimum partition — that is NP-hard in general and
 * nobody would see the difference — but it is a PARTITION, which is the property
 * that matters: every filled cell is covered exactly once, so the pieces cannot
 * overlap and parity cannot read solid stone as void.
 *
 * @returns [[i0,j0,i1,j1], …] in CELL indices, half-open.
 */
export function cellsToRects(cells) {
  const used = new Uint8Array(N * N);
  const out = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!cells[idx(i, j)] || used[idx(i, j)]) continue;
      let i1 = i;
      while (i1 + 1 < N && cells[idx(i1 + 1, j)] && !used[idx(i1 + 1, j)]) i1++;
      let j1 = j;
      grow: while (j1 + 1 < N) {
        for (let k = i; k <= i1; k++) if (!cells[idx(k, j1 + 1)] || used[idx(k, j1 + 1)]) break grow;
        j1++;
      }
      for (let b = j; b <= j1; b++) for (let a = i; a <= i1; a++) used[idx(a, b)] = 1;
      out.push([i, j, i1 + 1, j1 + 1]);
    }
  }
  return out;
}

/** …and the same rectangles in YARDS, which is what a recipe stores. */
export const rectsInYards = (cells) =>
  cellsToRects(cells).map(([i0, j0, i1, j1]) => [SLICES[i0], SLICES[j0], SLICES[i1], SLICES[j1]]);

/** Yard rectangles → a painted cell mask.  The way back in, for the board. */
export function cellsFromRects(rects) {
  const cells = new Uint8Array(N * N);
  for (const [x0, y0, x1, y1] of rects) {
    const i0 = planeIndex(x0), j0 = planeIndex(y0), i1 = planeIndex(x1), j1 = planeIndex(y1);
    if (i0 < 0 || j0 < 0 || i1 < 0 || j1 < 0) continue;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) cells[idx(i, j)] = 1;
  }
  return cells;
}

/* ------------------------------------------------------------- the codec -- */

/**
 * ONE CHARACTER PER COORDINATE.  Every slice plane is a whole number of
 * half-yards — 0, 4, 5, 6, 9, 12, 13, 14, 18 of them — and 18 is `i` in base 36.
 * So a rectangle is four characters and a ramp is five, and a whole block fits
 * on one line you can read.
 */
export const HY = (v) => {
  const h = Math.round(v * 2);
  if (Math.abs(h - v * 2) > 1e-9 || h < 0 || h > 35) throw new Error(`off the half-yard grid: ${v}`);
  return h.toString(36);
};
export const UNHY = (c) => {
  const h = parseInt(c, 36);
  return Number.isFinite(h) ? h / 2 : NaN;
};

// The codec's one assumption, checked at load rather than trusted: if the ladder
// is ever changed to something that is not a whole number of half-yards, this
// throws HERE, in one place, instead of silently rounding every drawing.
for (const p of SLICES) HY(p);

const encRect = ([x0, y0, x1, y1]) => HY(x0) + HY(y0) + HY(x1) + HY(y1);
const encRamp = (r) => HY(r.x0) + HY(r.y0) + HY(r.x1) + HY(r.y1) + r.dir;

/** One layer: its rectangles, then `!` and its ramps.  `-` is an empty layer,
 *  because a blank field between two commas is hard to see and easy to lose. */
export function encodeLayer({ cells, rects, ramps = [] }) {
  const R = rects || rectsInYards(cells);
  let s = R.map(encRect).join('');
  if (ramps.length) s += '!' + ramps.map(encRamp).join('');
  return s || '-';
}

/** A drawing → its recipe, which is its name and its whole identity. */
export function encodeDrawn(d) {
  return `D:${d.layers.map(encodeLayer).join(',')}:${d.mat || 'stone'}`;
}

/* ------------------------------------------------------------- the decode */

const bad = (recipe, why) => ({ ok: false, recipe, why });

/**
 * Parse a `D:` recipe, and REFUSE anything that would build a broken block.
 *
 * The grammar checks four things no painter can produce but a hand-written or
 * hand-edited recipe can:
 *
 *   · every coordinate on a slice plane, and inside the block
 *   · rectangles disjoint            — else parity reads the overlap as VOID
 *   · a ramp clear of the fill under it  — same reason, in three dimensions
 *   · a ramp's run at least one storey   — his rule, made checkable
 *
 * Report, never substitute: a block this version cannot build must say so.
 */
export function decodeDrawn(recipe, { allowEmpty = false } = {}) {
  const parts = recipe.split(':');
  if (parts.length !== 3) return bad(recipe, 'a drawing is D:layers:material');
  const fields = parts[1].split(',');
  if (fields.length !== LAYERS) {
    return bad(recipe, `a drawing needs ${LAYERS} layers, one per storey; this has ${fields.length}`);
  }

  const layers = [];
  for (let i = 0; i < fields.length; i++) {
    const L = parseLayer(fields[i] === '-' ? '' : fields[i], recipe, i);
    if (L.why) return L;
    layers.push(L);
  }
  // A DRAWING WITH NOTHING IN IT IS NOT A BLOCK, and refusing it is not
  // pedantry.  An empty mesh has no faces, and `maskFor` deliberately falls back
  // to FULLY SOLID when a mask comes back empty — safe for a bug in the ray
  // cast, disastrous here: the block would be invisible, stop every ray, and
  // reserve its cell.  The board of course starts blank, which is why it asks
  // for `allowEmpty`; a RECIPE may not be.
  if (!allowEmpty && !layers.some((L) => L.rects.length || L.ramps.length)) {
    return bad(recipe, 'a drawing with no stone in it is not a block');
  }
  return { ok: true, family: 'drawn', layers, mat: parts[2], recipe };
}

function parseLayer(src, recipe, li) {
  const [body, ramps = ''] = src.split('!');
  const where = `layer ${li}`;

  if (body.length % 4) return bad(recipe, `${where}: ${body.length} characters is not a whole number of rectangles`);
  const rects = [];
  const fill = new Uint8Array(N * N);
  for (let k = 0; k < body.length; k += 4) {
    const r = [UNHY(body[k]), UNHY(body[k + 1]), UNHY(body[k + 2]), UNHY(body[k + 3])];
    const why = stamp(fill, r, where, 'rectangle');
    if (why) return bad(recipe, why);
    rects.push(r);
  }

  if (ramps.length % 5) return bad(recipe, `${where}: ${ramps.length} characters is not a whole number of ramps`);
  const out = [];
  for (let k = 0; k < ramps.length; k += 5) {
    const box = [UNHY(ramps[k]), UNHY(ramps[k + 1]), UNHY(ramps[k + 2]), UNHY(ramps[k + 3])];
    const dir = ramps[k + 4];
    if (!DIRS.includes(dir)) return bad(recipe, `${where}: no such ramp direction: ${dir}`);
    // The fill and the ramps share one mask, so a ramp standing in the fill and
    // a ramp standing in another ramp are the same refusal.
    const why = stamp(fill, box, where, 'ramp');
    if (why) return bad(recipe, why);
    const run = dir === 'e' || dir === 'w' ? box[2] - box[0] : box[3] - box[1];
    if (run < RISE - 1e-9) {
      return bad(recipe, `${where}: a ramp climbs ${RISE} yards, so it needs ${RISE} of floorspace; this has ${run}`);
    }
    out.push({ x0: box[0], y0: box[1], x1: box[2], y1: box[3], dir, run });
  }
  return { rects, ramps: out, cells: fill };
}

/** Mark a rectangle's cells, and report the first thing wrong with it. */
function stamp(mask, [x0, y0, x1, y1], where, what) {
  const i0 = planeIndex(x0), j0 = planeIndex(y0), i1 = planeIndex(x1), j1 = planeIndex(y1);
  if (i0 < 0 || j0 < 0 || i1 < 0 || j1 < 0) {
    return `${where}: ${what} ${x0},${y0},${x1},${y1} has a corner off the slice planes`;
  }
  if (i1 <= i0 || j1 <= j0) return `${where}: ${what} ${x0},${y0},${x1},${y1} has no area`;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      // THE OVERLAP RULE, and it is not fussiness: two solids in the same place
      // are crossed twice by the solidity ray, so the overlap comes back VOID.
      // See handoff §2.3 — an L built from two full-length walls had a hole
      // where they met.
      if (mask[idx(i, j)]) return `${where}: ${what} ${x0},${y0},${x1},${y1} overlaps what is already there`;
      mask[idx(i, j)] = 1;
    }
  }
  return null;
}

/** A short label for the shelf.  Never an identity — the recipe is that. */
export function labelDrawn(d) {
  const parts = d.layers.map((L) => L.rects.length);
  const ramps = d.layers.reduce((n, L) => n + L.ramps.length, 0);
  return `drawn ${parts.join('·')}${ramps ? ` +${ramps} ramp${ramps > 1 ? 's' : ''}` : ''}`;
}

/* -------------------------------------------------------------- the stone */

/** A drawn block: each layer's rectangles extruded through its storey, and its
 *  ramps wedged into the same band. */
export function drawnMesh(d) {
  const m = new Mesh();
  d.layers.forEach((L, i) => {
    for (const r of L.rects) {
      extrudePlan(m, [rect(r[0], r[1], r[2], r[3])], DECKS[i], DECKS[i + 1], d.mat, `layer${i}`);
    }
    for (const r of L.ramps) rampWedge(m, r, DECKS[i], d.mat, `ramp${i}`);
  });
  tagFlat(m);
  return m;
}

/**
 * THE RAMP, as five faces.
 *
 * Written once, in the ramp's own frame — `a` along the run, uphill; `b` across
 * it; `z` up — and the four directions are four right-handed placements of that
 * frame into the world.  Deliberately NOT four hand-wound cases: a face wound
 * backwards is invisible from outside and solid-looking from within, which is
 * about the least legible bug there is.  `test/drawn.test.mjs` checks every face
 * of every direction points out of the wedge.
 *
 * The toe is a knife edge and that is what a ramp is.  What holds it up is the
 * designer's business — this is a drawing board, not a structural engineer.
 */
const FRAME = {
  e: { a: [1, 0, 0], b: [0, 1, 0], o: (r) => [r.x0, r.y0] },
  w: { a: [-1, 0, 0], b: [0, -1, 0], o: (r) => [r.x1, r.y1] },
  n: { a: [0, 1, 0], b: [-1, 0, 0], o: (r) => [r.x1, r.y0] },
  s: { a: [0, -1, 0], b: [1, 0, 0], o: (r) => [r.x0, r.y1] },
};

export function rampWedge(m, r, zb, mat, tag) {
  const f = FRAME[r.dir];
  const along = r.dir === 'e' || r.dir === 'w' ? r.x1 - r.x0 : r.y1 - r.y0;
  const across = r.dir === 'e' || r.dir === 'w' ? r.y1 - r.y0 : r.x1 - r.x0;
  const [ox, oy] = f.o(r);
  const zt = zb + RISE;
  const P = (a, b, z) => m.vert([ox + f.a[0] * a + f.b[0] * b, oy + f.a[1] * a + f.b[1] * b, z]);

  const A = P(0, 0, zb), B = P(along, 0, zb), C = P(along, across, zb), D = P(0, across, zb);
  const E = P(along, 0, zt), F = P(along, across, zt);

  const av = f.a, bv = f.b, Z = [0, 0, 1];
  const negA = [-av[0], -av[1], -av[2]], negB = [-bv[0], -bv[1], -bv[2]];
  // Up the slope: the run along, the rise up, normalised.
  const k = Math.hypot(along, RISE);
  const up = [av[0] * along / k, av[1] * along / k, RISE / k];

  const add = (v, o) => m.face(v, { mat, tag, ...o });
  add([A, D, C, B], { u: av, vDir: negB, hatch: 'u' });                     // the underside
  add([B, C, F, E], { u: bv, vDir: Z, hatch: 'v' });                        // the head
  add([A, B, E], { u: av, vDir: Z, hatch: 'v' });                           // the flanks
  add([C, D, F], { u: negA, vDir: Z, hatch: 'v' });
  // THE SLOPE IS A FORM, not a flat wall: it keeps its own frame, so the strokes
  // run ACROSS the ramp and read as its fall rather than taking the engraver's
  // house angle and reading as a leaning wall.  See mesh.js on `form`.
  add([A, E, F, D], { u: up, vDir: bv, hatch: 'v', form: true });
  return m;
}

export { S as BLOCK, DECKS };
