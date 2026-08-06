// cube.js — THE CUBE LAW.  The owner's modular-building rules, 2026-08-06.
//
// This replaces the socket ladder as the thing that makes independently
// generated blocks assemble.  The ladder constrained where a stair could CROSS
// a boundary and said nothing about the boundary itself, which is why composed
// blocks never cancelled a single face against each other — two procedurally
// different masses never put a face in the same place.  The new rule is
// stronger and simpler: **every curved thing in the game is struck with one of
// two radii, and every straight cut falls on one of nine planes.**  Two blocks
// that have never heard of each other then meet on the same lines.
//
// THE SPEC, in the owner's words:
//
//   "so the 1 man block, is composed of 9 sub blocks.  the radius blue circles
//    is all 2.5 except for the one whole block circle of 4.5.  that one will
//    mostly be used for making high vaulted arches.  each sub block is about 3'
//    cubed.  by making slices happen at the colored lines it makes it easier to
//    find pieces that line up."
//
// WHAT THE DIAGRAM MEASURES.  He drew a block in section on graph paper with
// four colours.  Reading the drawing back as numbers, in feet from a corner of
// a nine-foot block:
//
//   magenta   0, 9            the block boundary
//   black     3, 6            the sub-block grid — his nine cells
//   green     2, 4.5, 7       the tangents of the centred R2.5 circle, and the axis
//   ticks     2.5, 6.5        where a corner-struck R2.5 arc crosses an edge
//
// Every one of those checked out against the photograph to better than 1.5% of
// the block's width, which is as close as a felt pen on graph paper gets.  The
// centred black circle he drew measures 0.54 of the block wide; a 2.5-foot
// radius in a 9-foot block is 0.556.  The blue circle is tangent to all four
// edges, which is what a radius of 4.5 in a 9-foot block has to be.
//
// ONE THING TO CONFIRM WITH HIM: "composed of 9 sub blocks" is nine per FACE —
// the drawing is a section and it shows nine cells.  The block is 3x3x3 = 27
// sub-blocks.  Read the other way (nine per side, an 81-cell face) the radii
// would have to be in sub-blocks rather than feet, and the black grid in the
// drawing would have eight interior lines instead of the two he drew.  It has
// two.  But it is the one number that changes everything downstream, so it is
// worth one sentence of confirmation rather than a rebuild.

/* ------------------------------------------------------------------ scale -- */

/** Sub-blocks along one edge of a main block.  His nine cells, in section. */
export const SUB = 3;
/** Feet per sub-block. */
export const SUB_FEET = 3;
/** Feet per main block. */
export const BLOCK_FEET = SUB * SUB_FEET;              // 9

/**
 * THE LATTICE UNIT IS ONE SUB-BLOCK, and geometry is authored in FEET through
 * `FOOT`.  A one-foot lattice would make every number in the spec an integer,
 * which is tempting — but the occupancy map and the exact voxel DDA that
 * marches the light both step cell by cell, so a three-times finer lattice is a
 * three-times longer walk for every visibility ray in the world.  Sub-block
 * granularity is all the light needs and all the placement grid needs.
 */
export const FOOT = 1 / SUB_FEET;
export const METRES_PER_SUB = 0.9144;                   // 3 ft, exactly
export const BLOCK_METRES = SUB * METRES_PER_SUB;       // 2.7432 m

/* ----------------------------------------------------------------- radii -- */

/**
 * THE TWO RADII.  There are no others, and that is the whole of the rule.
 *
 * R is 2.5 feet: shafts, engaged columns, corner rounds, niches, the ribs of a
 * cross vault — everything.  R_WHOLE is 4.5 feet, which in a nine-foot block is
 * exactly half, so its circle is inscribed and tangent to all four faces at
 * their midpoints.  That is the one he means for high vaulted arches: it is the
 * largest arc a single block can hold, and a run of them is a barrel.
 *
 * Because R_WHOLE is exactly SUB/2 in lattice units, an arch struck with it
 * springs and crowns ON the boundary planes, so two neighbours agree at the
 * seam by construction — the same property that made the old sliced-vault tiles
 * cancel their cut faces, recovered without slicing anything.
 */
export const R = 2.5 * FOOT;                            // 0.8333… lattice
export const R_WHOLE = 4.5 * FOOT;                      // 1.5 lattice, == SUB/2

/* ----------------------------------------------------------- the planes -- */

/**
 * THE SLICE PLANES, in feet, per axis.  "by making slices happen at the colored
 * lines it makes it easier to find pieces that line up."
 *
 *   0, 9       the boundary          (magenta)
 *   3, 6       the sub-block grid    (black)
 *   2, 7       tangents of a centred R2.5 circle   (green)
 *   4.5        the axis              (green) — and the whole-block circle's centre
 *   2.5, 6.5   a corner-struck R2.5 arc's crossings (his edge ticks)
 *
 * Nothing in a primary form may end anywhere else.  A generator that wants a
 * wall at 3.7 feet does not get one; it gets 3 or 4.5, and so does every block
 * that will ever stand beside it.
 */
export const PLANES_FEET = [0, 2, 2.5, 3, 4.5, 6, 6.5, 7, 9];
export const PLANES = PLANES_FEET.map((f) => f * FOOT);

/** Snap a lattice coordinate to the nearest legal plane.  A generator should
 *  not need this — it should be built from the planes — but a snap is cheap
 *  insurance against a form drifting half an inch off the grid and quietly
 *  killing the face cancellation that the whole rule exists to buy. */
export function snap(v) {
  let best = PLANES[0], bd = Infinity;
  for (const p of PLANES) {
    const d = Math.abs(v - p);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Is this coordinate already on a plane?  Used by the tests. */
export const onPlane = (v, eps = 1e-9) => PLANES.some((p) => Math.abs(v - p) < eps);

/* ------------------------------------------------------------ the tiers -- */

/**
 * PRIMARY vs SECONDARY, which is his distinction and is load-bearing:
 *
 *   "the primary forms are these, but there may be secondary forms that are
 *    attached to these blocks that dont follow the rules, things like anchor
 *    points for chains, torches, rusty iron things, pulleys and wheels.  water
 *    features.  and other things that might be interacted with."
 *
 * PRIMARY is the masonry.  It obeys the radii and the planes absolutely, and
 * it is what makes blocks meet.  SECONDARY is everything bolted to it, and it
 * is explicitly exempt — a torch bracket that had to land on a slice plane
 * would be a worse torch bracket.  Keeping the exemption honest is what stops
 * the rule turning into a straitjacket: the grid is for the parts that must
 * agree with a neighbour, and nothing else.
 */
export const PRIMARY = 'primary';
export const SECONDARY = 'secondary';
