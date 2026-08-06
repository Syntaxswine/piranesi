// math.js — the world's axes, and the one projection this game is allowed to use.
//
// WORLD AXES.  x east, y north, **z up**.  Architecture is about levels, and a
// z-up world lets a storey be an integer.  Every module in this repo agrees on
// this; nothing converts.
//
// THE PROJECTION IS THE FIRST AESTHETIC DECISION IN THE REPO, so it lives here
// rather than in the renderer, and it is a LAW:
//
//     THE CAMERA NEVER PITCHES AND NEVER ROLLS.  IT SHIFTS.
//
// Look at any Carceri plate.  The piers are vertical on the paper — dead
// vertical, all of them, all the way to the top of the sheet — while the arches
// and cornices race away to vanishing points left and right.  That is not an
// accident of Piranesi's draughtsmanship, it is the scenographic convention he
// worked in: the picture plane is held vertical, and to get more ceiling you
// raise the *station point of the drawing*, not the eye.  A camera that tilts up
// converges the verticals, and the moment they converge the image stops being an
// architectural plate and becomes a photograph of a video game.
//
// So the camera here has yaw (free), height (free), and SHIFT — the equivalent
// of a view camera's rising front, or a tilt-shift lens.  Shift moves the
// principal point down the sensor, which brings the vault into frame with no
// convergence at all.  The proof is four lines of algebra and it is worth
// keeping in your head:
//
//   a vertical world line is  p(t) = p0 + t·(0,0,1)
//   the camera's right vector r and forward vector f are both HORIZONTAL
//   ⇒ X = (p−e)·r and Z = (p−e)·f do not depend on t
//   ⇒ screenX = cx + F·X/Z is constant along the line.   Vertical stays vertical.
//
// That only holds while r and f have no z component, i.e. while the camera does
// not pitch.  Do not "just add a pitch slider".  If you ever need to look down
// into a well, the honest move is a *negative* shift, not a tilt.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/* ---------------------------------------------------------------- vectors -- */
/* Points are plain 3-arrays.  Hot loops in the rasteriser unpack to scalars and
 * never call these; they are here for setup code, where clarity wins. */

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Newell's method — the plane normal of an arbitrary planar polygon.
 *  Robust where a cross-product of two edges is not: a polygon may have a
 *  near-degenerate corner (a voussoir's thin end does), and picking two edges
 *  by hand eventually picks those two.  Newell uses every edge. */
export function polyNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([nx, ny, nz]);
}

export function polyCentroid(pts) {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  const k = 1 / pts.length;
  return [x * k, y * k, z * k];
}

/** An orthonormal basis in the plane of `n`.  Used to lay hatching out in a
 *  face's OWN coordinates — see engrave.js, where that is the whole point. */
export function planeBasis(n) {
  // Pick the world axis least aligned with n, so the cross product is stable.
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const seed = az <= ax && az <= ay ? [0, 0, 1] : ay <= ax ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(seed, n));
  const v = cross(n, u); // already unit: n and u are unit and orthogonal
  return [u, v];
}

/* ------------------------------------------------------------ the camera -- */

/**
 * Yaw 0 looks along +x.  The basis is right-handed with screen-x to the right
 * and screen-y down:
 *
 *   f = ( cos yaw, sin yaw, 0)   forward, always horizontal
 *   r = ( sin yaw,-cos yaw, 0)   = f × up
 *   u = ( 0, 0, 1)               world up, always
 */
/**
 * THE TWO CAMERAS, and why the law above is not broken by the second one.
 *
 * EXPLORE mode keeps `pitch` at zero and uses `shift`, exactly as argued above:
 * you are inside the space, the verticals are dead vertical, and the picture is
 * a plate.  That is the whole aesthetic and it does not bend.
 *
 * BUILD mode is not a view of the space, it is a view of the MODEL — a three
 * quarter overhead, rotatable, with the layer you are working on picked out.
 * You cannot do that without looking down; a rising front can bring a ceiling
 * into frame but it can never show you the top of a floor slab.  So build mode
 * pitches, and it is honest about being a different instrument: a drawing board
 * rather than a plate.  Piranesi's own plans looked down; only his views did
 * not.
 *
 * `pitch` is therefore allowed but must stay 0 in explore mode, and the test
 * suite pins the vertical-line law against a zero-pitch camera.
 */
export class Camera {
  constructor(opts = {}) {
    this.eye = opts.eye ? opts.eye.slice() : [0, -14, 2.6];
    this.yaw = opts.yaw ?? 90 * DEG;
    /** Radians below horizontal. ZERO in explore mode, always. */
    this.pitch = opts.pitch ?? 0;
    /** Focal length in PIXELS.  Set through `setFraming`. */
    this.focal = opts.focal ?? 1000;
    /** Rising front, in pixels.  Positive = the plate looks upward. */
    this.shift = opts.shift ?? 0;
    this.width = opts.width ?? 1000;
    this.height = opts.height ?? 1300;
  }

  /** Horizontal field of view, in degrees, is the natural thing to reason about.
   *  Piranesi's plates imply a very wide angle — see docs; 70–90° is the range
   *  that produces his rate of recession without looking like a fisheye. */
  setFraming({ width, height, hfovDeg }) {
    if (width) this.width = width;
    if (height) this.height = height;
    if (hfovDeg) this.focal = (this.width / 2) / Math.tan(hfovDeg * DEG / 2);
    return this;
  }

  get hfovDeg() { return 2 * Math.atan((this.width / 2) / this.focal) / DEG; }

  /** The ground-plane basis: forward is horizontal whatever the pitch, so that
   *  walking and strafing never fly you into the floor. */
  basis() {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { f: [c, s, 0], r: [s, -c, 0], u: [0, 0, 1] };
  }

  /** Cache the numbers the hot loop needs, so projecting a vertex is a dozen
   *  multiplies and no property lookups on `this`.  At pitch 0 the z terms are
   *  exactly zero and the vertical-line law holds by construction. */
  snapshot() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return {
      ex: this.eye[0], ey: this.eye[1], ez: this.eye[2],
      // right stays horizontal under pitch — the camera never rolls
      rx: sy, ry: -cy, rz: 0,
      // forward tips down by `pitch`
      fx: cy * cp, fy: sy * cp, fz: -sp,
      // up is forward rotated a quarter turn in the vertical plane
      ux: cy * sp, uy: sy * sp, uz: cp,
      F: this.focal,
      cx: this.width / 2,
      cy: this.height / 2 + this.shift,
      w: this.width, h: this.height,
    };
  }

  /** → [screenX, screenY, invZ].  invZ ≤ 0 means behind the picture plane.
   *  We hand back 1/Z rather than Z because 1/Z is the quantity that
   *  interpolates linearly across a triangle in screen space, and the rasteriser
   *  wants exactly that. */
  project(p) {
    const c = this.snapshot();
    return projectWith(c, p[0], p[1], p[2]);
  }
}

export function projectWith(c, x, y, z) {
  const dx = x - c.ex, dy = y - c.ey, dz = z - c.ez;
  const X = dx * c.rx + dy * c.ry + dz * c.rz;
  const Y = dx * c.ux + dy * c.uy + dz * c.uz;
  const Z = dx * c.fx + dy * c.fy + dz * c.fz;
  if (Z <= 1e-4) return [0, 0, -1];
  const iz = 1 / Z;
  return [c.cx + c.F * X * iz, c.cy - c.F * Y * iz, iz];
}

/* --------------------------------------------------------- deterministic -- */
/* The etcher's hand must wobble the SAME WAY every frame, or the plate boils.
 * So: no Math.random anywhere in the renderer.  Every wobble is a hash of the
 * stroke's identity (which face, which hatch line, which segment).  Integer
 * hash, 32-bit, cheap; the classic xorshift-multiply finaliser. */

export function hash32(a, b = 0, c = 0) {
  let h = (a | 0) * 0x27d4eb2d ^ (b | 0) * 0x165667b1 ^ (c | 0) * 0x9e3779b1;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** hash → [0,1) */
export const hashf = (a, b = 0, c = 0) => hash32(a, b, c) / 4294967296;
/** hash → [-1,1) */
export const hashs = (a, b = 0, c = 0) => hashf(a, b, c) * 2 - 1;
