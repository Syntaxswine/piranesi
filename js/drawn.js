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
import { SUB, PLANES, DECKS, STOREY, R, R_WHOLE } from './cube.js';
import { rect, extrudePlan, CORNERS, columnAt, coveAt, drum, bored } from './plan.js';
import { tagFlat } from './forms.js';

const S = SUB;
const C = S / 2;

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

/**
 * THE CURVES, and there are only two kinds because the cube law only has two
 * radii and nine legal centres.
 *
 * A CORNER ROUND is a cell.  Since R = 2 the corner cell is exactly R by R, so
 * an arc struck at R about either end of its diagonal lies wholly inside it:
 * `o` keeps the quarter-disc about the block's own corner (a column), `c`
 * rounds the outer arris off instead (a cove).  `.` is no curve.  Four
 * characters, anticlockwise from the origin, the same order as `plan.js`
 * CORNERS — and the token OWNS its cell, so the paint underneath is ignored.
 *
 * A DISC is the layer.  The centred circle is struck about the axis at 4.5,
 * which is not a cell boundary at any radius, so it cannot be a cell thing:
 *   d  a free-standing drum at R — a column standing in the middle of the room
 *   s  the storey solid, with the R circle bored out of it   (`shaft`)
 *   b  the storey solid, with the WHOLE-BLOCK circle bored   (`bore`)
 * `d` shares its layer; `s` and `b` are the whole storey and take no paint,
 * which is not a limitation but what boring through something means.
 *
 * Between them the board can now draw every curve the grammar has — there is a
 * test that says so, plan by plan.
 */
export const CORNER_TOKENS = ['.', 'o', 'c'];
export const DISCS = { d: 'drum', s: 'shaft', b: 'bore' };
/** The cell each corner token owns: the corner cells of the board. */
export const CORNER_CELLS = [[0, 0], [N - 1, 0], [N - 1, N - 1], [0, N - 1]];
/** Cells a centred drum reserves — its bounding box is [C-R, C+R], which lands
 *  between planes, so the reservation is the cells that box touches. */
const DRUM_LO = SLICES.findIndex((v, i) => v <= C - R && SLICES[i + 1] > C - R);
const DRUM_HI = SLICES.findIndex((v) => v >= C + R);

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
    layers: Array.from({ length: LAYERS }, () => blankLayer()),
  };
}

export const blankLayer = () => ({ cells: new Uint8Array(N * N), ramps: [], corners: '....', disc: '' });

/** Which board cells a corner string takes over.  A token OWNS its cell, so the
 *  paint there is not merely covered — it is not emitted at all. */
export function ownedCells(corners = '....') {
  const out = [];
  for (let k = 0; k < 4; k++) if (corners[k] && corners[k] !== '.') out.push(CORNER_CELLS[k]);
  return out;
}

/** The cells a drum reserves.  It is round and the reservation is square, which
 *  is the conservative direction: a wall clipping the box really would cross
 *  the circle somewhere along it. */
export function drumCells() {
  const out = [];
  for (let j = DRUM_LO; j < DRUM_HI; j++) for (let i = DRUM_LO; i < DRUM_HI; i++) out.push([i, j]);
  return out;
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

/**
 * ONE LAYER, in canonical order: `<rectangles>~<corners>*<disc>!<ramps>`, and
 * `-` for an empty one — a blank field between two commas is hard to see and
 * easy to lose.  Everything after the rectangles is optional and each marker
 * appears at most once, which is what lets `splitLayer` take them off the end
 * one at a time without a parser.
 */
export function encodeLayer({ cells, rects, ramps = [], corners = '....', disc = '' }) {
  // A bore is the whole storey. Nothing else in the layer survives it, and
  // saying so in the encoding is better than encoding something that decode
  // will refuse.
  if (disc === 's' || disc === 'b') return '*' + disc;
  const owned = new Set(ownedCells(corners).map(([i, j]) => idx(i, j)));
  const paint = cells && owned.size
    ? cells.map((v, k) => (owned.has(k) ? 0 : v))
    : cells;
  let s = (rects || rectsInYards(paint)).map(encRect).join('');
  if (corners && corners !== '....') s += '~' + corners;
  if (disc) s += '*' + disc;
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
  if (!allowEmpty && !layers.some((L) => L.rects.length || L.ramps.length || L.disc || L.corners !== '....')) {
    return bad(recipe, 'a drawing with no stone in it is not a block');
  }
  return { ok: true, family: 'drawn', layers, mat: parts[2], recipe };
}

/** Take the optional trailers off the end, one marker at a time. */
function splitLayer(src) {
  let body = src, ramps = '', disc = '', corners = '';
  let i = body.indexOf('!');
  if (i >= 0) { ramps = body.slice(i + 1); body = body.slice(0, i); }
  i = body.indexOf('*');
  if (i >= 0) { disc = body.slice(i + 1); body = body.slice(0, i); }
  i = body.indexOf('~');
  if (i >= 0) { corners = body.slice(i + 1); body = body.slice(0, i); }
  return { body, corners, disc, ramps };
}

function parseLayer(src, recipe, li) {
  const { body, corners, disc, ramps } = splitLayer(src);
  const where = `layer ${li}`;
  const fill = new Uint8Array(N * N);

  /* ------------------------------------------------------------- the disc */
  if (disc && !DISCS[disc]) return bad(recipe, `${where}: no such disc: ${disc}`);
  const solidDisc = disc === 's' || disc === 'b';
  if (solidDisc && (body || corners || ramps)) {
    return bad(recipe, `${where}: a ${DISCS[disc]} is the whole storey — there is nothing left to put beside it`);
  }
  if (solidDisc) {
    return { rects: [], ramps: [], corners: '....', disc, cells: new Uint8Array(N * N).fill(1) };
  }

  /* --------------------------------------------------------- the corners */
  let corner = '....';
  if (corners) {
    if (corners.length !== 4) return bad(recipe, `${where}: a corner string is four characters, one per corner; this is ${corners.length}`);
    for (const ch of corners) if (!CORNER_TOKENS.includes(ch)) return bad(recipe, `${where}: no such corner: ${ch}`);
    corner = corners;
    // A token OWNS its cell, so claim it before anything else can.
    for (const [i, j] of ownedCells(corner)) fill[idx(i, j)] = 1;
  }

  /* ------------------------------------------------------ the rectangles */
  if (body.length % 4) return bad(recipe, `${where}: ${body.length} characters is not a whole number of rectangles`);
  const rects = [];
  for (let k = 0; k < body.length; k += 4) {
    const r = [UNHY(body[k]), UNHY(body[k + 1]), UNHY(body[k + 2]), UNHY(body[k + 3])];
    const why = stamp(fill, r, where, 'rectangle');
    if (why) return bad(recipe, why);
    rects.push(r);
  }

  // A drum stands in the middle of the room, so the middle of the room has to
  // be empty. Claimed after the rectangles so the message names the drum.
  if (disc === 'd') {
    for (const [i, j] of drumCells()) {
      if (fill[idx(i, j)]) return bad(recipe, `${where}: a drum stands on the axis, and there is masonry in the way`);
      fill[idx(i, j)] = 1;
    }
  }

  /* ------------------------------------------------------------ the ramps */
  if (ramps.length % 5) return bad(recipe, `${where}: ${ramps.length} characters is not a whole number of ramps`);
  const out = [];
  for (let k = 0; k < ramps.length; k += 5) {
    const box = [UNHY(ramps[k]), UNHY(ramps[k + 1]), UNHY(ramps[k + 2]), UNHY(ramps[k + 3])];
    const dir = ramps[k + 4];
    if (!DIRS.includes(dir)) return bad(recipe, `${where}: no such ramp direction: ${dir}`);
    // The fill, the corners, the drum and the ramps all share one mask, so
    // every way of putting two solids in the same place is the same refusal.
    const why = stamp(fill, box, where, 'ramp');
    if (why) return bad(recipe, why);
    const run = dir === 'e' || dir === 'w' ? box[2] - box[0] : box[3] - box[1];
    if (run < RISE - 1e-9) {
      return bad(recipe, `${where}: a ramp climbs ${RISE} yards, so it needs ${RISE} of floorspace; this has ${run}`);
    }
    out.push({ x0: box[0], y0: box[1], x1: box[2], y1: box[3], dir, run });
  }
  return { rects, ramps: out, corners: corner, disc, cells: fill };
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
  const parts = d.layers.map((L) => (L.disc && L.disc !== 'd' ? DISCS[L.disc] : L.rects.length));
  const extra = [];
  const ramps = d.layers.reduce((n, L) => n + L.ramps.length, 0);
  const rounds = d.layers.reduce((n, L) => n + [...L.corners].filter((c) => c !== '.').length, 0);
  if (ramps) extra.push(`${ramps} ramp${ramps > 1 ? 's' : ''}`);
  if (rounds) extra.push(`${rounds} round${rounds > 1 ? 's' : ''}`);
  if (d.layers.some((L) => L.disc === 'd')) extra.push('drum');
  return `drawn ${parts.join('·')}${extra.length ? ` +${extra.join(' +')}` : ''}`;
}

/* -------------------------------------------------------------- the stone */

/** A drawn block: each layer's rectangles extruded through its storey, and its
 *  ramps wedged into the same band. */
export function drawnMesh(d) {
  const m = new Mesh();
  d.layers.forEach((L, i) => {
    const z0 = DECKS[i], z1 = DECKS[i + 1];
    for (const r of L.rects) extrudePlan(m, [rect(r[0], r[1], r[2], r[3])], z0, z1, d.mat, `layer${i}`);
    // THE CURVES GO UP THE SAME WAY THE SQUARES DO. A corner round and a drum
    // are plans like any other — the only thing curved about them is the list
    // of points — so they are extruded by the same call and there is no path in
    // here that a rectangle does not also take.
    for (const p of cornerPolys(L.corners)) extrudePlan(m, [p], z0, z1, d.mat, `round${i}`);
    for (const p of discPolys(L.disc)) extrudePlan(m, [p], z0, z1, d.mat, `disc${i}`);
    for (const r of L.ramps) rampWedge(m, r, z0, d.mat, `ramp${i}`);
  });
  tagFlat(m);
  return m;
}

/** The polygons a corner string stands for — `plan.js` owns their geometry. */
export function cornerPolys(corners = '....') {
  const out = [];
  for (let k = 0; k < 4; k++) {
    if (corners[k] === 'o') out.push(columnAt(k));
    else if (corners[k] === 'c') out.push(coveAt(k));
  }
  return out;
}

/** …and the disc's. `bored` is already cut on the diagonals into four disjoint
 *  pieces, because the mesh has no notion of a hole. */
export function discPolys(disc) {
  if (disc === 'd') return drum();
  if (disc === 's') return bored(R);
  if (disc === 'b') return bored(R_WHOLE);
  return [];
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
