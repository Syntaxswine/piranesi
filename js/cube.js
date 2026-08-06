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
// four colours.  Reading the drawing back as numbers, in SUB-BLOCKS from a
// corner of a nine-sub-block block:
//
//   magenta   0, 9            the block boundary
//   black     3, 6            thirds
//   green     2, 4.5, 7       the tangents of the centred R2.5 circle, and the axis
//   ticks     2.5, 6.5        where a corner-struck R2.5 arc crosses an edge
//
// Every one of those checked out against the photograph to better than 1.5% of
// the block's width, which is as close as a felt pen on graph paper gets.  The
// centred black circle he drew measures 0.54 of the block wide; a radius of 2.5
// in a block of 9 is 0.556.  The blue circle is tangent to all four edges,
// which is what a radius of 4.5 in a block of 9 has to be.
//
// THE UNIT WAS THE ONE OPEN QUESTION AND HE ANSWERED IT: "its actually 9x9
// blocks if you want to get technical."  So the numbers above are SUB-BLOCKS,
// and a main block is 9 x 9 x 9 of them — 27 feet, 8.23 m.  I had read "composed
// of 9 sub blocks" as nine per face and built it at 3x3x3, which fitted the
// drawing equally well because the ratios are identical either way; the two
// readings differ only in what unit the radii are quoted in.  His is the better
// one and it is not close: at 3x3x3 the whole-block circle spans nine feet,
// which is a doorway, and he said that form is "mostly for making high vaulted
// arches".  At 9x9x9 it spans twenty-seven feet, which is a vault.
//
// Nothing in the geometry changed.  Every form is written in terms of SUB, R and
// R_WHOLE, so the rescale was four constants.

/* ------------------------------------------------------------------ scale -- */

/** Sub-blocks along one edge of a main block.  "its actually 9x9 blocks". */
export const SUB = 9;
/** Feet per sub-block. */
export const SUB_FEET = 3;
/** Feet per main block. */
export const BLOCK_FEET = SUB * SUB_FEET;              // 27

/**
 * THE LATTICE UNIT IS ONE SUB-BLOCK, and every number in his spec is already in
 * them — the radii, the slice planes, the grid.  So the geometry in this project
 * is written in the units it was designed in, with no conversion anywhere, which
 * is the only way a spec and an implementation stay comparable.
 *
 * `FOOT` exists for the few places a real-world size is the honest way to say
 * something (a handrail is 3 feet high, not 1 sub-block).
 */
export const FOOT = 1 / SUB_FEET;
export const METRES_PER_SUB = 0.9144;                   // 3 ft, exactly
export const BLOCK_METRES = SUB * METRES_PER_SUB;       // 8.2296 m — a man is 0.21 of it

/* ----------------------------------------------------------------- radii -- */

/**
 * THE TWO RADII.  There are no others, and that is the whole of the rule.
 *
 * R is 2.5 sub-blocks — seven and a half feet, 2.29 m — and it does shafts,
 * engaged columns, corner rounds, niches and the ribs of a cross vault.
 * R_WHOLE is 4.5, which in a block of 9 is exactly half, so its circle is
 * inscribed and tangent to all four faces at their midpoints.  That is the one
 * he means for high vaulted arches: twenty-seven feet of span, eight and a
 * quarter metres, the largest arc a single block can hold — and a run of them
 * is a barrel a man is a fifth as tall as.
 *
 * Because R_WHOLE is exactly SUB/2, an arch struck with it
 * springs and crowns ON the boundary planes, so two neighbours agree at the
 * seam by construction — the same property that made the old sliced-vault tiles
 * cancel their cut faces, recovered without slicing anything.
 */
export const R = 2.5;                                   // 7.5 ft, 2.29 m
export const R_WHOLE = 4.5;                             // 13.5 ft, == SUB/2

/* ----------------------------------------------------------- the planes -- */

/**
 * THE SLICE PLANES, in SUB-BLOCKS, per axis.  "by making slices happen at the colored
 * lines it makes it easier to find pieces that line up."
 *
 *   0, 9       the boundary          (magenta)
 *   3, 6       the thirds            (black)
 *   2, 7       tangents of a centred R2.5 circle   (green)
 *   4.5        the axis              (green) — and the whole-block circle's centre
 *   2.5, 6.5   a corner-struck R2.5 arc's crossings (his edge ticks)
 *
 * Nothing in a primary form may end anywhere else.  A generator that wants a
 * wall at 3.7 does not get one; it gets 3 or 4.5, and so does every block that
 * will ever stand beside it.
 */
export const PLANES = [0, 2, 2.5, 3, 4.5, 6, 6.5, 7, 9];
export const PLANES_FEET = PLANES.map((v) => v * SUB_FEET);

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
