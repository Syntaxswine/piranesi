// forms.js — THE PRIMARY FORMS.  Every one is struck with R or R_WHOLE and
// ends on a slice plane; see cube.js for the law and where it came from.
//
// WHY THESE ARE MOSTLY "HOLES".  Reading the owner's diagram back as geometry
// has one consequence worth stating out loud, because it is not obvious and it
// changes what a block IS: the whole-block circle of 4.5 feet is INSCRIBED in a
// nine-foot block, tangent to all four faces.  So a block built around it is
// almost entirely void — the masonry that survives is the corner spandrels and
// nothing else.  That is not a defect of the reading, it is what a vault piece
// has to be.  A barrel vault is a row of these, and the material you can see is
// the haunches; the space is the point.
//
// It also means THE SOLID BLOCK IS THE MOST IMPORTANT ONE IN THE SET.  He said
// so — "there are going to be blocks that are just solid space, so there will be
// situations where one block abuts another" — and it repairs the fault recorded
// in the backlog: two solid blocks side by side present identical square faces
// at the boundary plane, those faces coincide, and the coincidence rule cancels
// them.  A run of masonry becomes one mass instead of a stack of boxes.  Nothing
// in the previous composer could do that, because no two generated blocks ever
// put a face in the same place.

import { Mesh, box, sweep, arc } from './mesh.js';
import { SUB, R, R_WHOLE, FOOT, PRIMARY } from './cube.js';

const S = SUB;                       // 3 lattice units = 9 feet
const C = S / 2;                     // the block's axis, 4.5 feet
const STEPS = 12;                    // arc tessellation; even, so it lands on C

/** All six faces of the block boundary, for tagging. */
const SIDES = ['+x', '-x', '+y', '-y', '+z', '-z'];

/* ------------------------------------------------------------- the solid -- */

/**
 * A block that is just solid space.  Tagged on all six sides so that two of
 * them standing together cancel the wall between.
 */
export function solid(o = {}) {
  const m = new Mesh();
  box(m, [0, 0, 0], [S, S, S], { mat: o.mat || 'stone', tag: 'solid' });
  for (const f of m.faces) f.side = sideOfFace(m, f);
  return m;
}

/* ------------------------------------------------------------ the vaults -- */

/**
 * THE HIGH VAULT.  The whole-block circle, springing at the block's axis and
 * crowning at its top; the surviving material is the two upper spandrels.
 * `axis` is the direction the vault runs.
 *
 * The end caps take a `side`, which is the whole trick: two of these in a row
 * present identical spandrel cross-sections at the plane between them, the
 * faces cancel, and the run reads as one continuous tunnel rather than a
 * procession of separate arches with membranes between them.
 */
export function vault(axis = 'y', o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  const [a0, a1] = capSides(axis);
  // Left spandrel: up the arc from the springing to the crown, then out to the
  // corner.  Wound counter-clockwise in (a,c) so the interior is on the left.
  sweep(m, [...arc(C, C, R_WHOLE, Math.PI, Math.PI / 2, STEPS), [0, S]],
    axis, 0, S, { mat, tag: 'vault', sideA: a0, sideB: a1, hatch: 'v' });
  sweep(m, [...arc(C, C, R_WHOLE, Math.PI / 2, 0, STEPS), [S, S]],
    axis, 0, S, { mat, tag: 'vault', sideA: a0, sideB: a1, hatch: 'v' });
  tagFlat(m);
  return m;
}

/**
 * HALF A VAULT — one spandrel.  A lean-to, and the piece that lets a vault die
 * into a wall instead of stopping in mid-air.  `hand` is which side keeps its
 * masonry.
 */
export function halfVault(axis = 'y', hand = 'left', o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  const [a0, a1] = capSides(axis);
  const prof = hand === 'left'
    ? [...arc(C, C, R_WHOLE, Math.PI, Math.PI / 2, STEPS), [0, S]]
    : [...arc(C, C, R_WHOLE, Math.PI / 2, 0, STEPS), [S, S]];
  sweep(m, prof, axis, 0, S, { mat, tag: 'half-vault', sideA: a0, sideB: a1, hatch: 'v' });
  tagFlat(m);
  return m;
}

/**
 * THE BORE.  The whole circle taken out along an axis, leaving four corner
 * spandrels — a circular tunnel, or an oculus if it runs vertically.  This is
 * the R_WHOLE form at its most extreme and the least material a primary block
 * can have and still be a block.
 */
export function bore(axis = 'y', o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  const [a0, a1] = capSides(axis);
  for (const p of cornersOutside(C, C, R_WHOLE)) {
    sweep(m, p, axis, 0, S, { mat, tag: 'bore', sideA: a0, sideB: a1, hatch: 'v', sideAt: cutAt(p) });
  }
  tagFlat(m);
  return m;
}

/* ------------------------------------------------------- the R2.5 family -- */

/**
 * A COLUMN — the centred R2.5 drum, full height.  This is the black circle in
 * the owner's diagram, and its tangents are two of his green lines.
 */
export function column(o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  const ring = arc(C, C, R, 0, Math.PI * 2 * (1 - 1 / 16), 15);
  sweep(m, ring, 'z', 0, S, { mat, tag: 'column', sideA: '-z', sideB: '+z', hatch: 'u' });
  tagFlat(m);
  return m;
}

/**
 * A SHAFT — a solid block with the centred R2.5 circle bored vertically
 * through it.  A well, a light shaft, the space a spiral stair would wrap.
 * Built as four corner pieces because the mesh has no notion of a hole.
 */
export function shaft(o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  for (const p of cornersOutside(C, C, R)) {
    sweep(m, p, 'z', 0, S, { mat, tag: 'shaft', sideA: '-z', sideB: '+z', hatch: 'v', sideAt: cutAt(p) });
  }
  tagFlat(m);
  return m;
}

/**
 * FOUR ENGAGED COLUMNS at the block's corners — the blue corner arcs.  Struck
 * about the corners themselves, so each is a quarter round that a neighbour's
 * quarter round completes into a whole column standing on the joint.  Four
 * blocks meeting at a vertical arris grow one shaft between them, and none of
 * them knew about the others.
 */
export function cornerShafts(o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  const q = [[0, 0, 0, Math.PI / 2], [S, 0, Math.PI / 2, Math.PI],
    [S, S, Math.PI, Math.PI * 1.5], [0, S, Math.PI * 1.5, Math.PI * 2]];
  for (const [cx, cy, t0, t1] of q) {
    sweep(m, [[cx, cy], ...arc(cx, cy, R, t0, t1, STEPS)], 'z', 0, S,
      { mat, tag: 'corner-shaft', sideA: '-z', sideB: '+z', hatch: 'u' });
  }
  tagFlat(m);
  return m;
}

/**
 * A SOLID with its four vertical arrises rounded off at R2.5.  A pier you can
 * walk past without catching your shoulder, and the form that reads most like a
 * worn toy block.
 */
export function rounded(o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  const plan = [
    ...arc(R, R, R, Math.PI, Math.PI * 1.5, STEPS),
    ...arc(S - R, R, R, Math.PI * 1.5, Math.PI * 2, STEPS),
    ...arc(S - R, S - R, R, 0, Math.PI / 2, STEPS),
    ...arc(R, S - R, R, Math.PI / 2, Math.PI, STEPS),
  ];
  sweep(m, plan, 'z', 0, S, { mat, tag: 'rounded', sideA: '-z', sideB: '+z', hatch: 'v' });
  tagFlat(m);
  return m;
}

/**
 * A NICHE — the R2.5 half-round recessed into one face of a solid block.  The
 * home for a bust, a lamp or nothing at all, and the cheapest way to make a
 * long wall stop reading as a slab.
 */
export function niche(side = '-y', o = {}) {
  const m = new Mesh();
  const mat = o.mat || 'stone';
  // Plan of the material: the square, with a half-disc bitten out of one edge.
  const bite = arc(C, 0, R, 0, Math.PI, STEPS).map(([x, y]) => [x, y]);
  const plan = [[0, 0], ...bite.slice().reverse(), [S, 0], [S, S], [0, S]];
  sweep(m, plan, 'z', 0, S, { mat, tag: 'niche', sideA: '-z', sideB: '+z', hatch: 'v' });
  tagFlat(m);
  void side;
  return m;
}

/* ------------------------------------------------------------- the shelf -- */

/** Everything the composer may reach for, in one place, so an instrument can
 *  draw the whole vocabulary without knowing any of their names. */
export const FORMS = {
  solid: () => solid(),
  'vault-y': () => vault('y'),
  'vault-x': () => vault('x'),
  'half-vault': () => halfVault('y', 'left'),
  'bore-y': () => bore('y'),
  'bore-z': () => bore('z'),
  column: () => column(),
  shaft: () => shaft(),
  'corner-shafts': () => cornerShafts(),
  rounded: () => rounded(),
  niche: () => niche(),
};

export const FORM_TIER = PRIMARY;

/* ------------------------------------------------------------- machinery -- */

/**
 * The pieces of a square that survive a circle cut out of its middle, as closed
 * plan polygons wound so the interior is on the left.  The mesh has no notion
 * of a hole, so a shape with one has to be cut into simple pieces.
 *
 * THERE ARE TWO CASES AND USING THE WRONG ONE IS SILENT.  I used one for both
 * and the picture came back with a block-with-a-hole drawn as three thin
 * slabs — which is what a wrong decomposition looks like: not an error, just a
 * different object.
 *
 *   r >= S/2 — the circle reaches the edges, so what is left is FOUR SEPARATE
 *              CORNERS.  Cut corner-to-tangent-to-tangent.
 *   r <  S/2 — the circle floats clear of the edges, so what is left is one
 *              ring-shaped region.  Cut it on the square's diagonals into four
 *              trapezoids, each running from a whole edge to a quarter of arc.
 */
function cornersOutside(cx, cy, r) {
  const A = (t0, t1) => arc(cx, cy, r, t0, t1, STEPS);
  const d = Math.PI / 4;
  if (r >= S / 2 - 1e-9) {
    // Tangent or larger: four separate corners, each running edge → arc → edge.
    return [
      [[0, 0], ...A(6 * d, 4 * d)],
      [[S, 0], ...A(8 * d, 6 * d)],
      [[S, S], ...A(2 * d, 0)],
      [[0, S], ...A(4 * d, 2 * d)],
    ];
  }
  // Clear of the edges: one ring, cut on the diagonals into four trapezoids.
  // Each keeps a whole edge of the square and the quarter of arc facing it, so
  // four of them tile the ring exactly and no piece has a hole in it.
  return [
    [[0, 0], [S, 0], ...A(-d, -3 * d)],        // south
    [[S, 0], [S, S], ...A(d, -d)],             // east
    [[S, S], [0, S], ...A(3 * d, d)],          // north
    [[0, S], [0, 0], ...A(-3 * d, -5 * d)],    // west
  ];
}

/**
 * Which profile edges of a bored piece are ARBITRARY CUTS rather than real
 * surfaces — the straight run from a corner of the square in to the arc.  Both
 * neighbouring pieces own the same cut, so tagging it lets the coincidence rule
 * cancel the pair and the block reads as one bored mass instead of a ring of
 * wedges with joints between them.
 *
 * Identified geometrically rather than by index, because the two decompositions
 * in `cornersOutside` put their cuts in different places and an index rule would
 * be right for one and silently wrong for the other.  A cut is the only kind of
 * edge that runs from a point at the circle's radius to a point that is not.
 */
function cutAt(profile) {
  const n = profile.length;
  const rad = (p) => Math.hypot(p[0] - C, p[1] - C);
  const onArc = profile.map((p) => Math.abs(rad(p) - R) < 1e-6 || Math.abs(rad(p) - R_WHOLE) < 1e-6);
  const flat = (a, b) => [0, S].some((v) =>
    (Math.abs(a[0] - v) < 1e-6 && Math.abs(b[0] - v) < 1e-6) ||
    (Math.abs(a[1] - v) < 1e-6 && Math.abs(b[1] - v) < 1e-6));
  return (i) => {
    const j = (i + 1) % n;
    // AN EDGE ON A BOUNDARY PLANE IS NEVER A CUT, however it is shaped.  When
    // the circle is tangent to the square the corner pieces run corner → tangent
    // ALONG the square's own edge, and that edge has one end on the arc and one
    // not — so the radius test alone calls it a cut, tags the block's outer wall
    // as an internal surface, and quietly kills the cancellation between
    // neighbouring blocks that the whole cube law exists to produce.
    if (flat(profile[i], profile[j])) return null;
    return onArc[i] !== onArc[j] ? 'cut' : null;
  };
}

/** Which boundary plane a face lies on, or null.  A post-pass, because a part
 *  has no idea where it was placed — the same reason `tagBoundaryFaces` in
 *  compose.js is a post-pass.  See handoff §3.4. */
function sideOfFace(m, f) {
  const EPS = 1e-6;
  const planes = [['+x', 0, S], ['-x', 0, 0], ['+y', 1, S], ['-y', 1, 0], ['+z', 2, S], ['-z', 2, 0]];
  for (const [side, ax, at] of planes) {
    let on = true;
    for (const i of f.v) if (Math.abs(m.verts[i][ax] - at) > EPS) { on = false; break; }
    if (on) return side;
  }
  return null;
}

/** Tag every face that turns out to lie on a boundary plane, whatever built it.
 *  `sweep` already tags its caps; this catches the flanks of a form that runs
 *  out to an edge, which is most of them. */
function tagFlat(m) {
  for (const f of m.faces) if (!f.side) f.side = sideOfFace(m, f);
  return m;
}

function capSides(axis) {
  return axis === 'x' ? ['-x', '+x'] : axis === 'z' ? ['-z', '+z'] : ['-y', '+y'];
}

void SIDES; void FOOT;
