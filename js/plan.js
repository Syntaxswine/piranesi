// plan.js — A BLOCK IS A STACK OF PLANS.
//
// The owner's second drawing, and it is the generator rather than a shape:
//
//   "i tried to imagine an example of how the slice lines can be used in
//    unusual combinations to make a wide variety of shapes and structures.
//    vertically i stuck to just the basic 1/3rd slices for this one block."
//
// He drew one block as three coloured slabs — purple, blue, green — stacked on
// the sub-block thirds, each with a DIFFERENT PLAN cut on the slice lines, and
// an arch struck across the top two.  That is the whole composer:
//
//     a block = three layers; a layer = a plan extruded one sub-block.
//
// It is a much better generator than the archetype-plus-attachments one it
// replaces, for three reasons.
//
// 1. THE VARIETY IS COMBINATORIAL AND THE SPEC IS TINY.  Sixteen plans with
//    their distinct turns is 34 layer choices; three layers is eighty thousand
//    blocks before anything else is added, and every one of them legal by
//    construction.  The old composer needed six hand-written archetypes to
//    reach twenty-four.
//
// 2. IT CANNOT PRODUCE AN ILLEGAL BLOCK.  Every vertex of every plan is on a
//    slice plane or on one of the two radii, so a block cannot drift off the
//    grid and quietly stop meeting its neighbours.  The old one could and did.
//
// 3. THE INTERFACES LOOK AFTER THEMSELVES.  Where one layer sits on another the
//    two surfaces are coincident and face opposite ways, so whichever you can
//    see, the other is a backface or is buried.  No boolean geometry anywhere,
//    which is just as well because there is none in this repo.
//
// A plan is a list of closed polygons in the 9 x 9 sub-block square — a list,
// because a plan may be disconnected: two bars with a gap between them is a plan.

// FOOT is used only on planIsLegal's failure path, to report the offending
// vertex in feet — which is why it was missing for so long: the checker threw a
// ReferenceError instead of naming the illegal vertex, at the one moment it
// existed to be useful.
import { SUB, R, R_WHOLE, PLANES, FOOT } from './cube.js';
import { arc } from './mesh.js';

const S = SUB;                       // 9 sub-blocks
const C = S / 2;                     // 4.5 — the axis, and R_WHOLE
const STEPS = 10;

/** The legal cuts a rectilinear plan may use: his coloured lines, minus the two
 *  ends.  In sub-blocks, because that is the unit he specified them in. */
export const CUTS = [2, 2.5, 3, 4.5, 6, 6.5, 7];

/* ---------------------------------------------------------- rectilinear -- */

/** A rectangle → a closed polygon, wound CCW. */
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/**
 * An L.  The chevron he drew in all three layers — a square with one corner
 * taken out, which in a three-quarter view reads as an arrow and is the single
 * most useful plan in the set: two of them back to back make a room, four make
 * a courtyard, and one on its own is a corner of a wall.
 */
export function ell(cut = 4.5) {
  return [[
    [0, 0], [S, 0], [S, cut], [cut, cut], [cut, S], [0, S],
  ].map(([x, y]) => [x, y])];
}

/** A strip across the block.  `a`,`b` on the cross axis, in sub-blocks. */
export function bar(a = 3, b = 6) { return [rect(0, a, S, b)]; }

/** Two strips with a gap — a plan may be disconnected, and a pair of piers with
 *  a void between them is exactly the sort of thing that makes a Carceri. */
export function twin(w = 3) { return [rect(0, 0, S, w), rect(0, S - w, S, S)]; }

/** One corner only. */
export function corner(w = 4.5) { return [rect(0, 0, w, w)]; }

/** A T. */
export function tee(w = 3) { return [rect(0, C - w / 2, S, C + w / 2), rect(C - w / 2, 0, C + w / 2, w)]; }

/** A cross — two bars, one plan, and the piece every vaulted crossing needs. */
export function cross(w = 3) {
  const lo = (S - w) / 2, hi = S - lo;
  return [rect(0, lo, S, hi), rect(lo, 0, hi, lo), rect(lo, hi, hi, S)];
}

/** A square ring: the block minus a court in the middle.  Four bars, because a
 *  polygon with a hole in it is not something this mesh can express. */
export function frame(w = 2) {
  return [
    rect(0, 0, S, w), rect(0, S - w, S, S),
    rect(0, w, w, S - w), rect(S - w, w, S, S - w),
  ];
}

/** The whole square. */
export function full() { return [rect(0, 0, S, S)]; }

/** A square with a notch bitten out of one edge — the hatched bite in his
 *  purple layer. */
export function notch(w = 3, d = 3) {
  const a = (S - w) / 2, b = S - a;
  return [[
    [0, 0], [a, 0], [a, d], [b, d], [b, 0],
    [S, 0], [S, S], [0, S],
  ]];
}

/* ------------------------------------------------- the WALL family ------ */
//
// THE SIMPLEST PIECE IN ARCHITECTURE, AND IT WAS MISSING.  The vocabulary had
// plans with 0, 2, 3 and 4 complete walls and NOTHING with exactly one: `twin`
// is literally two of these side by side, and nobody ever wrote the single.
// Every configuration that starts from one wall — an L of walls, a T, a curve —
// was unreachable in consequence.
//
// Found by coding each plan the way the owner does, four sides clockwise from
// twelve, each side in three segments, X for stone and O for open. Six of his
// fourteen archetypes existed; these five close most of the gap.
//
// EVERY PIECE MUST BE DISJOINT.  Two overlapping rectangles are crossed twice
// by the solidity ray, so parity reads the overlap as VOID: an L built from two
// full-length walls came back with a hole where they meet. That is why `bored`
// is cut into four and `frame` into four — the mesh has no notion of a union.

/** A wall along one edge. `XXX XOO OOO OOX`. */
export function wall(d = 3) { return [rect(0, S - d, S, S)]; }

/** Two walls meeting at a corner — the second stops short of the first, or the
 *  overlap punches a hole in the join. `XXX XXX XOO OOX`. */
export function wallEll(d = 3) { return [rect(0, S - d, S, S), rect(S - d, 0, S, S - d)]; }

/** A wall with a quarter-column at each far corner, so three sides read as an
 *  opening between piers. `XXX XOX XOX XOX` — the owner's T intersection. */
export function wallTee(d = 3) {
  return [rect(0, S - d, S, S), quarterAt(0, 0, 0), quarterAt(S, 0, 1)];
}

/** Two walls at a corner plus the one column the far corner still needs.
 *  `XXX XXX XOX XOX` — his L curve. */
export function wallCurve(d = 3) {
  return [rect(0, S - d, S, S), rect(S - d, 0, S, S - d), quarterAt(0, 0, 0)];
}

/** Masonry at two diagonally opposite corners and nothing else.
 *  `XOO OOX XOO OOX` — his two corners. */
export function cornersTwo(w = 3) {
  return [rect(0, S - w, w, S), rect(S - w, 0, S, w)];
}

/** A single pier standing out from the middle of one side, the rest open.
 *  `OOO OOO OOO OXO`. */
export function stub(w = 3, d = 3) { return [rect((S - w) / 2, 0, (S + w) / 2, d)]; }

/** One quarter-column, struck about a corner of the block. `k` is which
 *  quadrant of the circle survives, counted anticlockwise from due east. */
function quarterAt(cx, cy, k) {
  return [[cx, cy], ...arc(cx, cy, R, k * Math.PI / 2, (k + 1) * Math.PI / 2, STEPS)];
}

/* -------------------------------------------------------------- curved --- */

/**
 * The square with its four vertical arrises rounded at R.
 *
 * THE CENTRES ARE DERIVED FROM R, not written down beside it. They used to be
 * the literals 2.5 and 6.5, which are correct only while R happens to be 2.5 —
 * and `planIsLegal` computes its legal centres AS `[R, R]`, so the two would
 * disagree the moment anyone touched the radius. Trying exactly that reported
 * `legality: BROKEN for rounded`, from a plan that had not changed.
 *
 * Byte-identical at R = 2.5: the arc is tangent to both walls, so its centre is
 * at (R, R) by construction, which is what makes the round land on a slice
 * plane at all. Same family as the `ell-deep` mass bug — a derived quantity
 * written by hand next to the thing it derives from.
 */
export function roundedPlan() {
  return [[
    ...arc(R, R, R, Math.PI, Math.PI * 1.5, STEPS),
    ...arc(S - R, R, R, Math.PI * 1.5, Math.PI * 2, STEPS),
    ...arc(S - R, S - R, R, 0, Math.PI / 2, STEPS),
    ...arc(R, S - R, R, Math.PI / 2, Math.PI, STEPS),
  ]];
}

/** A free-standing drum on the block's axis. */
export function drum() {
  return [arc(C, C, R, 0, Math.PI * 2 * (1 - 1 / 16), 15)];
}

/** Four quarter-columns struck about the block's own corners, so four blocks
 *  meeting at an arris grow one whole shaft between them and none of them knew
 *  about the others. */
export function quarters() {
  return [
    [[0, 0], ...arc(0, 0, R, 0, Math.PI / 2, STEPS)],
    [[S, 0], ...arc(S, 0, R, Math.PI / 2, Math.PI, STEPS)],
    [[S, S], ...arc(S, S, R, Math.PI, Math.PI * 1.5, STEPS)],
    [[0, S], ...arc(0, S, R, Math.PI * 1.5, Math.PI * 2, STEPS)],
  ];
}

/** The square with the R2.5 circle bored out of the middle, cut on the
 *  diagonals into four pieces because the mesh has no notion of a hole. */
export function bored(r = R) {
  const d = Math.PI / 4;
  const A = (t0, t1) => arc(C, C, r, t0, t1, STEPS);
  if (r >= C - 1e-9) {
    return [
      [[0, 0], ...A(6 * d, 4 * d)],
      [[S, 0], ...A(8 * d, 6 * d)],
      [[S, S], ...A(2 * d, 0)],
      [[0, S], ...A(4 * d, 2 * d)],
    ];
  }
  return [
    [[0, 0], [S, 0], ...A(-d, -3 * d)],
    [[S, 0], [S, S], ...A(d, -d)],
    [[S, S], [0, S], ...A(3 * d, d)],
    [[0, S], [0, 0], ...A(-3 * d, -5 * d)],
  ];
}

/* --------------------------------------------------------- the vocabulary */

/**
 * THE SHELF.  Every plan a layer may take, with the turns that give a distinct
 * result — `turns: 1` for the ones with four-fold symmetry, so the generator
 * does not offer four copies of the same block and call it variety.
 */
export const PLANS = {
  full: { make: full, turns: 1 },
  ell: { make: () => ell(4.5), turns: 4 },
  'ell-deep': { make: () => ell(6), turns: 4 },
  bar: { make: () => bar(3, 6), turns: 2 },
  'bar-wide': { make: () => bar(2, 7), turns: 2 },
  twin: { make: () => twin(3), turns: 2 },
  corner: { make: () => corner(4.5), turns: 4 },
  tee: { make: () => tee(3), turns: 4 },
  cross: { make: () => cross(3), turns: 1 },
  frame: { make: () => frame(2), turns: 1 },
  notch: { make: () => notch(3, 2.5), turns: 4 },
  // The wall family — the owner's archetypes 4, 8, 16, 20, 36 and the single
  // pier. Adding a plan is free by the grammar's own contract: no existing
  // recipe mentions these, so nothing already built changes.
  wall: { make: () => wall(3), turns: 4 },
  'wall-ell': { make: () => wallEll(3), turns: 4 },
  'wall-tee': { make: () => wallTee(3), turns: 4 },
  'wall-curve': { make: () => wallCurve(3), turns: 4 },
  'corners-two': { make: () => cornersTwo(3), turns: 2 },
  stub: { make: () => stub(3, 3), turns: 4 },
  rounded: { make: roundedPlan, turns: 1 },
  drum: { make: drum, turns: 1 },
  quarters: { make: quarters, turns: 1 },
  shaft: { make: () => bored(R), turns: 1 },
  bore: { make: () => bored(C), turns: 1 },
};

export const PLAN_IDS = Object.keys(PLANS);

/** How much of the square a plan covers, by the shoelace, summed over its
 *  disjoint pieces.  Curved plans come out to the tessellation's area rather
 *  than the true circle's, which is right: the tessellation is what gets built. */
export function planArea(polys) {
  let a = 0;
  for (const poly of polys) {
    let s = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    }
    a += Math.abs(s) / 2;
  }
  return a;
}

/**
 * MASS IS MEASURED, NOT DECLARED.
 *
 * It used to be a literal beside each plan, and one of them was wrong by a
 * factor of one and a half: `ell-deep` claimed 0.56 while `ell(6)` covers 0.89
 * of the square.  0.56 is the area of `ell(3)` — so the number recorded what
 * the plan was MEANT to be and the geometry did something else, and the two had
 * no way of noticing.  `rollRecipe` sorts a stack heaviest-first, so a plan that
 * is nearly solid had been sorting as though it were half air.
 *
 * A derived quantity written down by hand next to the thing it derives from is
 * a bug with a delay on it.  Compute it.
 */
for (const id of PLAN_IDS) PLANS[id].mass = planArea(PLANS[id].make()) / (S * S);

/** Turn a plan a quarter turn at a time about the block's centre.  Rotation is
 *  the only transform a plan gets; nothing is ever mirrored, for the reason
 *  mesh.js `turnY` gives. */
export function turnPlan(polys, q) {
  const k = ((q % 4) + 4) % 4;
  if (!k) return polys;
  const t = ([x, y]) => {
    switch (k) {
      case 1: return [S - y, x];
      case 2: return [S - x, S - y];
      default: return [y, S - x];
    }
  };
  return polys.map((p) => p.map(t));
}

/* ------------------------------------------------------------- the check -- */

/**
 * IS THIS PLAN LEGAL?  Every straight vertex must sit on a slice plane in both
 * axes, and every other vertex must sit at exactly R or R_WHOLE from a legal
 * centre.  Nothing else is allowed anywhere in the game's masonry.
 *
 * The centres are themselves on the grid: the block's axis, its four corners,
 * and the four points a corner round is struck from.
 */
const CENTRES = [
  [C, C], [0, 0], [S, 0], [S, S], [0, S],
  [R, R], [S - R, R], [S - R, S - R], [R, S - R],
];

export function planIsLegal(polys, eps = 1e-6) {
  const onPlane = (v) => PLANES.some((p) => Math.abs(v - p) < eps);
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (onPlane(x) && onPlane(y)) continue;
      const ok = CENTRES.some(([cx, cy]) => {
        const d = Math.hypot(x - cx, y - cy);
        return Math.abs(d - R) < eps || Math.abs(d - R_WHOLE) < eps;
      });
      if (!ok) return { ok: false, at: [x / FOOT, y / FOOT] };
    }
  }
  return { ok: true };
}
