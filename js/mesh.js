// mesh.js — the geometry, and the ONE piece of metadata that makes it an
// engraving rather than a 3D model: every face carries its own (u,v) frame.
//
// WHY A FACE NEEDS A FRAME.  The obvious way to hatch a surface is to take its
// normal, build any old basis in the plane, and rule lines across it.  Do that
// and every face in the scene gets its hatch angle from the direction it points,
// which means all the +x faces in a Carceri are hatched identically and the
// picture turns into a pattern swatch.  Piranesi does the opposite: the hatch
// direction describes the FORM.  Strokes wrap ACROSS a barrel vault following
// its curve; they run DOWN a pier with its height; they run WITH the grain of a
// beam.  Look at Plate VII and the vault hatching is unmistakably a set of
// ribs — it is drawn along the generatrix, not along the paper.
//
// So a face is built knowing the surface it came off.  An extruded profile hands
// each of its quads a u that runs along the sweep and a v that runs along the
// profile, and the hatcher then asks for "along v" and gets ribs round the
// barrel for free, on every vault, at every orientation, with no special cases.
// This is bedrock: it is a fact about the surface, not a trick played on it.
//
// Units: one lattice CELL is 1×1×1 with its origin at the min corner.  What a
// cell means in feet lives in blocks.js.

import { sub, cross, norm, polyNormal, polyCentroid, planeBasis } from './math.js';

/** Faces whose dihedral angle is gentler than this are NOT drawn as creases —
 *  otherwise every facet of a tessellated vault becomes a ruled line and the
 *  arch reads as a folded fan.  A 16-segment semicircle steps 11.25°, a box
 *  corner is 90°, so anything in between is a safe threshold. */
export const CREASE_MIN_DEG = 26;

export const MATERIALS = {
  /** Travertine / peperino ashlar: big blocks, deep joints, weathered arrises. */
  stone: { course: 'ashlar', tone: 0.00, rough: 1.0 },
  /** The same stone, but rusticated — the drafted-margin blocks of the piers. */
  rustic: { course: 'rustic', tone: 0.04, rough: 1.4 },
  /** Brick-faced concrete, the Roman standard; fine horizontal courses. */
  brick: { course: 'brick', tone: 0.06, rough: 0.7 },
  /** Rendered/plastered vault surfaces — no joints, just tone. */
  plaster: { course: 'none', tone: -0.04, rough: 0.4 },
  /** Baulks and planks: grain along the member, iron straps at the joints. */
  timber: { course: 'grain', tone: 0.10, rough: 0.9 },
  /** Wrought iron: rings, chains, grilles.  Always the darkest thing present. */
  iron: { course: 'none', tone: 0.28, rough: 0.5 },
};

export class Mesh {
  constructor() {
    this.verts = [];
    this.faces = [];
  }

  vert(p) { this.verts.push(p); return this.verts.length - 1; }

  /**
   * Add one planar convex polygon, wound counter-clockwise seen from OUTSIDE.
   *
   * @param {number[]} idx    vertex indices
   * @param {object} o
   *   mat    key into MATERIALS
   *   u,vDir the surface's own axes (3-vectors, model space).  Omit and we fall
   *          back to an arbitrary in-plane basis — fine for a scrap of geometry,
   *          wrong for anything with a form to describe.  (It is `vDir`, not
   *          `v`, because `f.v` is the vertex index list and a face carrying two
   *          different meanings of `v` is a bug waiting to be written.)
   *   hatch  hatch direction, in the (u,v) frame: 'u' | 'v' | radians
   *   side   '+x' '-x' '+y' '-y' '+z' '-z' — this face lies ON that face of the
   *          cell and is culled when the neighbouring cell is solid there.
   *   tag    a name, for instruments and for tests.
   */
  face(idx, o = {}) {
    const f = {
      v: idx.slice(),
      mat: o.mat || 'stone',
      u: o.u ? o.u.slice() : null,
      vDir: o.vDir ? o.vDir.slice() : null,
      hatch: o.hatch ?? 'v',
      side: o.side || null,
      tag: o.tag || '',
      tone: o.tone ?? 0,
      /**
       * FORM.  Set on a face that belongs to a curved or directional surface —
       * the intrados of a vault, the flank of a drum, the grain of a baulk.
       * Those keep their own (u,v) frame when hatched, so the strokes wrap the
       * barrel and run with the timber.
       *
       * Everything else is FLAT, and a flat face lets the engraver's hand pick
       * the angle: measurement of the plates puts 53-66% of all line energy in
       * one family at 40 degrees, which no per-surface frame would ever
       * produce.  Marking a flat wall `form` makes it hatch along its own
       * height, and a building of those reads as corduroy.
       */
      form: !!o.form,
    };
    this.faces.push(f);
    return f;
  }

  /** Merge another mesh, optionally through a transform `xf(p) -> p`.
   *  Directions go through `xfDir`, which differences two transformed points —
   *  correct for the rotations and translations this game uses, and the reason
   *  a block turned a quarter turn still hatches along its own barrel. */
  merge(other, xf) {
    const base = this.verts.length;
    for (const p of other.verts) this.verts.push(xf ? xf(p) : p.slice());
    for (const f of other.faces) {
      this.faces.push({
        ...f,
        v: f.v.map((i) => i + base),
        u: f.u ? (xf ? xfDir(xf, f.u) : f.u.slice()) : null,
        vDir: f.vDir ? (xf ? xfDir(xf, f.vDir) : f.vDir.slice()) : null,
      });
    }
    return this;
  }

  points(f) { return f.v.map((i) => this.verts[i]); }

  /**
   * Resolve every face's geometry once: plane, normal, centroid, and the (u,v)
   * frame orthonormalised into the face's plane.  Blocks are built once and
   * placed thousands of times, so this is done at catalogue-build time.
   */
  finish() {
    for (const f of this.faces) {
      const pts = this.points(f);
      f.n = polyNormal(pts);
      f.c = polyCentroid(pts);
      f.area = polyArea(pts, f.n);

      let u = f.u, v = f.vDir;
      if (!u) {
        [u, v] = planeBasis(f.n);
      } else {
        // Project the declared u into the plane and re-derive v from it, so a
        // hand-written axis that is a degree off the surface still yields an
        // orthonormal frame instead of a sheared one.
        const d = u[0] * f.n[0] + u[1] * f.n[1] + u[2] * f.n[2];
        u = norm([u[0] - f.n[0] * d, u[1] - f.n[1] * d, u[2] - f.n[2] * d]);
        v = cross(f.n, u);
      }
      f.uAxis = u;
      f.vAxis = v;
      // The hatch direction, resolved to a world vector lying in the plane.
      const a = f.hatch === 'u' ? 0 : f.hatch === 'v' ? Math.PI / 2 : f.hatch;
      const ca = Math.cos(a), sa = Math.sin(a);
      f.hatchDir = [
        u[0] * ca + v[0] * sa,
        u[1] * ca + v[1] * sa,
        u[2] * ca + v[2] * sa,
      ];
    }
    this.edges = buildEdges(this);
    return this;
  }
}

function xfDir(xf, d) {
  // A direction transforms as the difference of two transformed points, which
  // is right for the rigid transforms this game uses (rotate + translate) and
  // would be wrong the moment anything scales non-uniformly.  Nothing does.
  const a = xf([0, 0, 0]), b = xf(d);
  return norm(sub(b, a));
}

function polyArea(pts, n) {
  let ax = 0, ay = 0, az = 0;
  for (let i = 0, m = pts.length; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    ax += a[1] * b[2] - a[2] * b[1];
    ay += a[2] * b[0] - a[0] * b[2];
    az += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs((ax * n[0] + ay * n[1] + az * n[2]) * 0.5);
}

/**
 * The edge table.  Each undirected edge learns which faces share it, which is
 * what lets the renderer classify it:
 *
 *   1 face          → a BORDER edge.  Always drawn — it is the boundary of a
 *                     surface, e.g. the open end of a vault.
 *   2 faces, sharp  → a CREASE.  Drawn: it is a real arris in the stone.
 *   2 faces, gentle → suppressed unless it turns out to be a SILHOUETTE at
 *                     render time (one face toward the eye, one away), which is
 *                     how the smooth flank of a round tower gets its outline.
 */
function buildEdges(mesh) {
  const map = new Map();
  mesh.faces.forEach((f, fi) => {
    const n = f.v.length;
    for (let i = 0; i < n; i++) {
      const a = f.v[i], b = f.v[(i + 1) % n];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let e = map.get(key);
      if (!e) map.set(key, (e = { a: Math.min(a, b), b: Math.max(a, b), f: [] }));
      e.f.push(fi);
    }
  });
  const cos = Math.cos(CREASE_MIN_DEG * Math.PI / 180);
  const out = [];
  for (const e of map.values()) {
    if (e.f.length === 1) e.kind = 'border';
    else {
      const n0 = mesh.faces[e.f[0]].n, n1 = mesh.faces[e.f[1]].n;
      const d = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
      e.kind = d < cos ? 'crease' : 'smooth';
    }
    out.push(e);
  }
  return out;
}

/* ================================================================ builders */

/** An axis-aligned box.  `sides` names which of the six faces to emit, so a
 *  half-buried plinth need not carry a bottom nobody will ever see. */
export function box(m, [x0, y0, z0], [x1, y1, z1], o = {}) {
  const mat = o.mat || 'stone';
  const P = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ].map((p) => m.vert(p));
  const skip = new Set(o.skip || []);
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

  // A vertical wall is hatched DOWN its height by default: that is how a pier is
  // modelled in ink, and it is why Piranesi's piers read as prisms rather than
  // as flat panels.  A horizontal slab is hatched along +x.
  const add = (idx, side, u, v, hatch) => {
    if (skip.has(side)) return;
    m.face(idx, { mat, side: o.cell === false ? null : side, u, vDir: v, hatch, tag: o.tag });
  };
  add([P[1], P[2], P[6], P[5]], '+x', Y, Z, o.hatch ?? 'v');
  add([P[3], P[0], P[4], P[7]], '-x', [0, -1, 0], Z, o.hatch ?? 'v');
  add([P[2], P[3], P[7], P[6]], '+y', [-1, 0, 0], Z, o.hatch ?? 'v');
  add([P[0], P[1], P[5], P[4]], '-y', X, Z, o.hatch ?? 'v');
  add([P[4], P[5], P[6], P[7]], '+z', X, Y, o.hatchTop ?? 'u');
  add([P[3], P[2], P[1], P[0]], '-z', X, [0, -1, 0], o.hatchTop ?? 'u');
  return m;
}

/**
 * Sweep a 2-D profile along an axis — the workhorse.  Arches, vaults, cornices,
 * string courses, plank treads and beam mouldings are all this.
 *
 * @param profile  [[a,c], …] in the profile plane, wound so the interior is on
 *                 the left; a CLOSED loop if `closed`.
 * @param axis     'x' | 'y' | 'z' — which world axis the profile is swept along.
 *                 For a horizontal sweep the profile's `a` runs along the other
 *                 horizontal axis and `c` runs up.  For 'z' — a vertical prism,
 *                 which is what a column, a bored shaft or a block with its
 *                 arrises rounded off actually is — the profile is a PLAN:
 *                 `a` is x and `c` is y.
 * @param s0,s1    sweep extent along `axis`.
 *
 * Every quad it emits gets u = along the sweep, v = along the profile.  That is
 * the whole reason this function exists rather than a pile of `box` calls: ask a
 * swept surface to hatch 'v' and the strokes run round the arc.
 */
export function sweep(m, profile, axis, s0, s1, o = {}) {
  const mat = o.mat || 'stone';
  const closed = o.closed !== false;
  const n = profile.length;
  const at = (a, c, s) => (axis === 'x' ? [s, a, c] : axis === 'z' ? [a, c, s] : [a, s, c]);
  const along = axis === 'x' ? [1, 0, 0] : axis === 'z' ? [0, 0, 1] : [0, 1, 0];
  const AX = axis === 'x' ? 0 : axis === 'z' ? 2 : 1;

  const A = profile.map(([a, c]) => m.vert(at(a, c, s0)));
  const B = profile.map(([a, c]) => m.vert(at(a, c, s1)));

  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const p0 = profile[i], p1 = profile[j];
    const da = p1[0] - p0[0], dc = p1[1] - p0[1];
    const L = Math.hypot(da, dc) || 1;
    const vDir = at(da / L, dc / L, 0);
    vDir[AX] = 0;
    m.face([A[i], A[j], B[j], B[i]], {
      mat, u: along, vDir, hatch: o.hatch ?? 'v', tag: o.tag,
      // `sideAt` lets a caller mark INDIVIDUAL profile edges.  It exists for
      // shapes with a hole in them: the mesh has no notion of one, so a bored
      // block is cut into pieces, and the cuts are arbitrary surfaces that both
      // pieces own.  Marking them makes the coincidence rule cancel the pair,
      // which is exactly what it is for — otherwise the arbitrary cut prints as
      // a crease and the block looks like it was assembled from wedges.
      side: (o.sideAt ? o.sideAt(i) : null) || o.side || null,
      form: o.form !== false,
    });
  }
  if (o.caps !== false && closed) {
    // The end faces.  They lie on the cell boundary when a vault runs to the
    // edge of its cell, so they take a `side` and get culled against the next
    // bay — which is what makes a run of vaults one continuous tunnel instead of
    // a row of separate arches with membranes between them.
    const capU = axis === 'x' ? [0, 1, 0] : [1, 0, 0];
    // A vertical prism's caps are its plan, so their second frame axis is y,
    // not z — hatching them up the wall would run the strokes off the surface.
    const capV = axis === 'z' ? [0, 1, 0] : [0, 0, 1];
    m.face(A.slice().reverse(), { mat, u: capU, vDir: capV, hatch: o.hatchCap ?? 'v', side: o.sideA || null, tag: o.tag });
    m.face(B.slice(), { mat, u: capU, vDir: capV, hatch: o.hatchCap ?? 'v', side: o.sideB || null, tag: o.tag });
  }
  return m;
}

/** Points along a circular arc in the profile plane, centre (ca,cc). */
export function arc(ca, cc, r, a0, a1, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (a1 - a0) * (i / steps);
    out.push([ca + Math.cos(t) * r, cc + Math.sin(t) * r]);
  }
  return out;
}

/**
 * A pointed arch, struck from two centres — the "gothic" arch of Carceri XIV.
 * `rise` selects the centres: 0.5 is an equilateral arch (centres at the
 * opposite springing points), smaller is blunter, larger is lancet.
 */
export function pointedArc(halfSpan, springZ, r, steps) {
  const off = r - halfSpan;
  const top = Math.sqrt(Math.max(0, r * r - off * off));
  const apex = Math.PI - Math.acos(Math.min(1, Math.max(-1, off / r)));
  const left = arc(-off, springZ, r, Math.PI - apex, Math.PI / 2, steps);
  const right = arc(off, springZ, r, Math.PI / 2, apex, steps);
  void top;
  return left.concat(right.slice(1));
}

/** A body of revolution about the vertical through (cx,cy): towers, columns,
 *  drums, capstans.  `profile` is [[radius, z], …] bottom to top. */
export function lathe(m, cx, cy, profile, seg = 16, o = {}) {
  const mat = o.mat || 'stone';
  const rings = profile.map(([r, z]) => {
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      ring.push(m.vert([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]));
    }
    return ring;
  });
  for (let k = 0; k < profile.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const t = ((i + 0.5) / seg) * Math.PI * 2;
      // u runs AROUND the drum, v runs UP it.  Hatching 'v' therefore rules
      // strokes up the shaft; hatching 'u' wraps them round it like the courses
      // of the round tower in Plate III.  Both are wanted, in different places.
      m.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], {
        mat,
        u: [-Math.sin(t), Math.cos(t), 0],
        vDir: [0, 0, 1],
        hatch: o.hatch ?? 'v',
        tag: o.tag,
        form: o.form !== false,
      });
    }
  }
  if (o.capTop !== false) {
    m.face(rings[rings.length - 1].slice(), { mat, u: [1, 0, 0], vDir: [0, 1, 0], hatch: 'u', tag: o.tag });
  }
  if (o.capBottom) m.face(rings[0].slice().reverse(), { mat, u: [1, 0, 0], vDir: [0, -1, 0], hatch: 'u', tag: o.tag });
  return m;
}

/**
 * A square-section member between two arbitrary points.
 *
 * THE ONE THING A LATTICE CANNOT GIVE YOU IS A DIAGONAL, and the Carceri are
 * held together by diagonals: knee braces, raking shores, the ropes and beams
 * that cross the whole plate.  So a block may place its own members off-axis
 * inside its cell, and this is how.  The member gets a frame built from its own
 * direction, which means its faces hatch WITH the timber instead of with the
 * world — a brace hatched along +z reads as a wall standing at an angle.
 */
export function strut(m, p0, p1, r, o = {}) {
  const mat = o.mat || 'timber';
  const d = norm(sub(p1, p0));
  // Any perpendicular will do for a square section; pick the stable one.
  const seed = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const a = norm(cross(seed, d));
  const b = cross(d, a);
  const corner = (p, sa, sb) => m.vert([
    p[0] + a[0] * sa * r + b[0] * sb * r,
    p[1] + a[1] * sa * r + b[1] * sb * r,
    p[2] + a[2] * sa * r + b[2] * sb * r,
  ]);
  const A = [corner(p0, -1, -1), corner(p0, 1, -1), corner(p0, 1, 1), corner(p0, -1, 1)];
  const B = [corner(p1, -1, -1), corner(p1, 1, -1), corner(p1, 1, 1), corner(p1, -1, 1)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // u runs along the member — so `hatch: 'u'` gives grain, 'v' gives banding.
    m.face([A[i], A[j], B[j], B[i]], { mat, u: d, vDir: i % 2 ? b : a, hatch: o.hatch ?? 'u', tag: o.tag || 'strut', form: true });
  }
  m.face(A.slice().reverse(), { mat, u: a, vDir: b, hatch: 'u', tag: o.tag || 'strut' });
  m.face(B.slice(), { mat, u: a, vDir: b, hatch: 'u', tag: o.tag || 'strut' });
  return m;
}

/* ------------------------------------------------------------ transforms -- */

/** Rotate about the cell's vertical centre axis, in quarter turns.  Blocks are
 *  authored once facing -y and turned into place; nothing is ever mirrored,
 *  because a mirror flips the light and Piranesi's light has a direction. */
export function turnY(q, sx = 1, sy = 1) {
  const k = ((q % 4) + 4) % 4;
  return ([x, y, z]) => {
    switch (k) {
      case 1: return [sy - y, x, z];
      case 2: return [sx - x, sy - y, z];
      case 3: return [y, sx - x, z];
      default: return [x, y, z];
    }
  };
}

export const translate = (dx, dy, dz) => ([x, y, z]) => [x + dx, y + dy, z + dz];
