// build.js — the drawing board: layers, the working plane, and the two cameras.
//
// The game is a peaceful layer-by-layer builder, so almost everything the player
// does is expressed here rather than in the renderer: which layer is live, what
// counts as above and below it, where a click lands on the floor of that layer,
// and how the view sits over it.  The engraver knows nothing about layers except
// the one number it is handed per block.
//
// A LAYER IS ONE MAIN BLOCK TALL.  The lattice counts sub-cells, a main block is
// SUB of them on a side, so layer L is the slab of cells z ∈ [L·SUB, (L+1)·SUB).
// Placement snaps to that grid in all three axes.  There is no half-height
// placement and there should not be: the whole promise of toy blocks is that
// they meet.

import { Camera, DEG, projectWith } from './math.js';
import { SUB, METRES_PER_SUB } from './cube.js';

export const LAYER = SUB;
export const BUILD = 'build';
export const EXPLORE = 'explore';

/** Grid (column, row, layer) → the lattice cell a block anchors at. */
export const cellOf = (gx, gy, L) => [gx * LAYER, gy * LAYER, L * LAYER];
/** …and back. `Math.floor` so negatives round the right way; `|0` does not. */
export const gridOf = (x, y, z) => [Math.floor(x / LAYER), Math.floor(y / LAYER), Math.floor(z / LAYER)];

/**
 * THE LAYER BAND OF A BLOCK: signed layer distance from the one being worked
 * on.  0 is live, positive is above (ghosted), negative is below (shadowed).
 * This is the entire interface between the builder and the renderer — palette.js
 * turns the number into tone.
 */
export function bandFor(workingLayer) {
  return (b) => Math.floor(b.z / LAYER) - workingLayer;
}

/* ------------------------------------------------------------- the views -- */

/**
 * THE BUILD CAMERA.  Three-quarter overhead, rotatable, orbiting the working
 * layer.
 *
 * Two decisions worth keeping.  It is nearly ORTHOGRAPHIC — a long focal length
 * from a long way off — because a builder wants a block on the far side of the
 * model to be the same size as one under your nose, and perspective in a
 * placement view is a nuisance dressed as realism.  And it orbits the WORKING
 * LAYER, not the model: the layer you are editing stays put as you turn, while
 * the building moves around it.
 */
export const BUILD_PITCH = 34 * DEG;
/** A long way off with a long lens.  Not a style choice: at this distance the
 *  convergence over a dozen blocks is under a degree, so a block at the back of
 *  the model is the same size as one at the front and placement is honest. */
export const BUILD_DIST = 420;
/** Half-width of the framed area at zoom 1, in lattice units — about five main
 *  blocks across. */
export const BUILD_RADIUS = LAYER * 2.6;

export function buildCamera(cam, { centre, layer, yaw, zoom = 1, width, height }) {
  const z0 = layer * LAYER;
  const radius = BUILD_RADIUS / Math.max(0.2, zoom);
  cam.yaw = yaw;
  cam.pitch = BUILD_PITCH;
  cam.shift = 0;
  cam.eye = [
    centre[0] - Math.cos(yaw) * BUILD_DIST * Math.cos(BUILD_PITCH),
    centre[1] - Math.sin(yaw) * BUILD_DIST * Math.cos(BUILD_PITCH),
    z0 + BUILD_DIST * Math.sin(BUILD_PITCH),
  ];
  cam.setFraming({ width, height, hfovDeg: 2 * Math.atan(radius / BUILD_DIST) / DEG });
  return cam;
}

/** THE EXPLORE CAMERA.  Pitch stays zero — this one is a plate, and the whole
 *  aesthetic rests on verticals being vertical.  See math.js. */
export function exploreCamera(cam, { eye, yaw, shift, width, height, fov = 76 }) {
  cam.yaw = yaw;
  cam.pitch = 0;
  cam.eye = eye.slice();
  cam.shift = shift;
  cam.setFraming({ width, height, hfovDeg: fov });
  return cam;
}

/** Eye height of a person standing on layer L, in lattice units. */
export const standingOn = (L) => L * LAYER + 1.75 / METRES_PER_SUB;

/* ------------------------------------------------------------- the cursor -- */

/**
 * Screen point → the point where the eye ray meets the horizontal plane at
 * world z.  Analytic, and deliberately NOT a depth-buffer read: the cursor has
 * to land on the floor of the working layer even where nothing is built there,
 * and an empty floor is not in the stencil.
 * @returns [x, y] in lattice units, or null if the ray never gets there.
 */
export function groundHit(camera, sx, sy, z) {
  const c = camera.snapshot();
  const a = (sx - c.cx) / c.F, b = -(sy - c.cy) / c.F;
  const dz = c.rz * a + c.uz * b + c.fz;
  if (Math.abs(dz) < 1e-6) return null;
  const t = (z - c.ez) / dz;
  if (t <= 0) return null;
  return [
    c.ex + (c.rx * a + c.ux * b + c.fx) * t,
    c.ey + (c.ry * a + c.uy * b + c.fy) * t,
  ];
}

/** The grid cell under the pointer on the working layer's floor. */
export function pickCell(camera, sx, sy, layer) {
  const p = groundHit(camera, sx, sy, layer * LAYER);
  if (!p) return null;
  return [Math.floor(p[0] / LAYER), Math.floor(p[1] / LAYER)];
}

/* ------------------------------------------------------------- the board -- */

/**
 * The grid the player builds on, projected: a list of screen polylines.
 *
 * This is drawn as CHROME, over the finished plate, by the 2-D context — it is
 * not bitten into it.  That is not a shortcut, it is the point: the plate is
 * re-bitten only when the building or the view changes, so moving the mouse
 * costs a few dozen lines and nothing else.  The owner flagged re-render time on
 * the first build; hover was most of it.
 */
export function boardLines(camera, layer, half = 6, centre = [0, 0]) {
  const z = layer * LAYER;
  const c = camera.snapshot();
  const cx = Math.round(centre[0] / LAYER), cy = Math.round(centre[1] / LAYER);
  const out = [];
  const at = (gx, gy) => projectWith(c, gx * LAYER, gy * LAYER, z);
  for (let i = -half; i <= half; i++) {
    for (const [a, b] of [
      [at(cx - half, cy + i), at(cx + half, cy + i)],
      [at(cx + i, cy - half), at(cx + i, cy + half)],
    ]) {
      if (a[2] > 0 && b[2] > 0) out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
}

/** The four corners of one grid cell's floor, projected. Null if behind. */
export function cellOutline(camera, gx, gy, layer, rise = 0) {
  const c = camera.snapshot();
  const z = layer * LAYER + rise;
  const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) =>
    projectWith(c, (gx + dx) * LAYER, (gy + dy) * LAYER, z));
  return pts.some((p) => p[2] <= 0) ? null : pts;
}

export { Camera };
