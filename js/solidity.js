// solidity.js — WHICH CELLS OF A BLOCK ARE ACTUALLY STONE.
//
// `World.place` stamps every cell of a block's footprint into the occupancy
// map, and it has to: the footprint is what the block RESERVES, and a column
// that only reserved its own drum would let you drop a wall through the middle
// of it.  But the light marches that same map, and the light does not care what
// a block reserves — it cares what is in the way.
//
// Measured on the new form vocabulary: all eleven forms stamped 27 cells of 27,
// including `bore-y`, which is a tunnel you can see straight through, and
// `column`, which is a drum standing in a mostly empty cube.  So a colonnade was
// exactly as opaque as a solid wall, an arcade let no light through its arches,
// and the whole point of marching the lattice — that a tunnel gets darker the
// further in you look, which no normal-based model can produce — was being
// thrown away one block at a time.  It did not show as an obvious fault because
// the old composer's blocks were also mostly void, so everything was uniformly
// too dark and it read as a mood.
//
// The fix is a second, finer map: the footprint still reserves the whole box,
// and a separate SOLIDITY MASK says which of its cells a ray should stop in.
//
// The mask is computed once per catalogue entry and cached on it, by casting
// rays from sample points inside each cell and counting crossings.  Odd is
// inside.  It is the oldest trick there is and it needs nothing but the face
// list — plus a bounding-box prefilter, without which it is unshippable.

/** A deliberately irrational-ish direction.  An axis-aligned ray through an
 *  axis-aligned lattice hits edges and vertices constantly, and every one of
 *  those is a double-count or a miss; a skew ray hits none of them. */
const DIR = (() => {
  const d = [1, 0.0137, 0.0071];
  const L = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / L, d[1] / L, d[2] / L];
})();

/**
 * Per-face bounds, cached on the mesh, so a ray only tests the faces it could
 * possibly reach.
 *
 * WITHOUT THIS THE MASK IS UNSHIPPABLE.  A composed block at the old scale is
 * 512 cells and 559 faces, and sixty-four samples a cell is thirty-three
 * thousand ray casts — 313 ms for ONE block, seven and a half seconds to warm a
 * catalogue of twenty-four, on the main thread, at boot.  The ray runs very
 * nearly along +x, so its y and z barely move; a face whose y or z range the
 * ray never enters cannot be crossed and does not need the plane solve.
 */
function boundsOf(mesh) {
  if (mesh._sbounds) return mesh._sbounds;
  const n = mesh.faces.length;
  const b = {
    ylo: new Float64Array(n), yhi: new Float64Array(n),
    zlo: new Float64Array(n), zhi: new Float64Array(n),
    xhi: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    let ylo = Infinity, yhi = -Infinity, zlo = Infinity, zhi = -Infinity, xhi = -Infinity;
    for (const vi of mesh.faces[i].v) {
      const p = mesh.verts[vi];
      if (p[1] < ylo) ylo = p[1]; if (p[1] > yhi) yhi = p[1];
      if (p[2] < zlo) zlo = p[2]; if (p[2] > zhi) zhi = p[2];
      if (p[0] > xhi) xhi = p[0];
    }
    b.ylo[i] = ylo; b.yhi[i] = yhi; b.zlo[i] = zlo; b.zhi[i] = zhi; b.xhi[i] = xhi;
  }
  mesh._sbounds = b;
  return b;
}

/** How far the ray can wander off +x before it leaves the mesh.  Generous: an
 *  under-estimate here silently drops a crossing and turns solid stone hollow. */
function drift(mesh) {
  let span = 0;
  for (const p of mesh.verts) if (p[0] > span) span = p[0];
  return { y: DIR[1] / DIR[0] * span + 1e-6, z: DIR[2] / DIR[0] * span + 1e-6 };
}

/** Is this point inside the closed mesh?  Ray cast, crossings counted. */
export function insideMesh(mesh, px, py, pz) {
  let crossings = 0;
  const b = boundsOf(mesh);
  const d = mesh._sdrift || (mesh._sdrift = drift(mesh));
  const yhi = py + d.y, zhi = pz + d.z;
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    if (b.xhi[fi] < px) continue;                     // entirely behind the start
    if (b.ylo[fi] > yhi || b.yhi[fi] < py) continue;  // the ray never gets there
    if (b.zlo[fi] > zhi || b.zhi[fi] < pz) continue;
    const f = mesh.faces[fi];
    const n = f.n;
    const denom = n[0] * DIR[0] + n[1] * DIR[1] + n[2] * DIR[2];
    if (Math.abs(denom) < 1e-9) continue;             // ray runs along the face
    const v0 = mesh.verts[f.v[0]];
    const t = ((v0[0] - px) * n[0] + (v0[1] - py) * n[1] + (v0[2] - pz) * n[2]) / denom;
    if (t <= 1e-9) continue;                          // behind the start point
    const hx = px + DIR[0] * t, hy = py + DIR[1] * t, hz = pz + DIR[2] * t;
    if (inFace(mesh, f, hx, hy, hz)) crossings++;
  }
  return (crossings & 1) === 1;
}

/** Point-in-polygon for a face, in whichever plane it projects to most
 *  strongly — projecting a near-edge-on face gives a degenerate outline and a
 *  coin-toss answer. */
function inFace(mesh, f, hx, hy, hz) {
  const n = f.n;
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let i0, i1;
  if (ax >= ay && ax >= az) { i0 = 1; i1 = 2; }
  else if (ay >= az) { i0 = 0; i1 = 2; }
  else { i0 = 0; i1 = 1; }
  const h = [hx, hy, hz];
  const u = h[i0], v = h[i1];
  let inside = false;
  const V = f.v, m = V.length;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const a = mesh.verts[V[i]], b = mesh.verts[V[j]];
    const au = a[i0], av = a[i1], bu = b[i0], bv = b[i1];
    if ((av > v) !== (bv > v) && u < (bu - au) * (v - av) / (bv - av) + au) inside = !inside;
  }
  return inside;
}

/**
 * Where to sample inside a cell, and this is the whole difficulty.
 *
 * NOT THE CENTRE.  A block is three cells on a side, so a cell centre lands on
 * 0.5, 1.5, 2.5 — and 1.5 is the block's own mid-plane, which is where every
 * arc in the game is struck from, where a vault springs, and where the
 * whole-block circle is tangent to the walls.  Sampling there asks the ray cast
 * the one question it cannot answer, and it answered wrong: a bore, which is a
 * tunnel you can see straight through, came back SOLID in its middle cell.
 *
 * Sixty-four samples on an off-grid lattice instead: quarters offset by an
 * eighth, so no sample lands on a cell edge, a half or a third.
 */
export const SAMPLE_OFFSETS = [0.125, 0.375, 0.625, 0.875];
const OFF = SAMPLE_OFFSETS;
/**
 * What fraction of the sixty-four must be inside for the cell to stop a ray.
 *
 * Twenty per cent, and the number is doing real work: it is the line between a
 * THIN WALL crossing a cell, which must block light, and the FLANK OF A COLUMN
 * clipping the corner of one, which must not.  A one-foot wall through a
 * three-foot cell fills about a third of it; the drum of a 2.5-foot column
 * reaches about a seventh of its neighbours.  Measured on the real forms, not
 * guessed: at 12% a colonnade went opaque, at 30% a wall let daylight through.
 *
 * Eight samples on a coarser lattice could not tell them apart at any threshold
 * — the wall fell exactly between the sample planes and registered as nothing.
 */
const FILL = 0.20;

/**
 * The solidity mask of a block-shaped mesh: a Uint8Array of `sx·sy·sz`, indexed
 * `x + sx*(y + sy*z)`, 1 where the cell holds enough stone to stop a ray.
 */
export function solidityMask(mesh, [sx, sy, sz]) {
  const out = new Uint8Array(sx * sy * sz);
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        let n = 0;
        for (const dz of OFF) for (const dy of OFF) for (const dx of OFF) {
          if (insideMesh(mesh, x + dx, y + dy, z + dz)) n++;
        }
        if (n >= FILL * OFF.length ** 3) out[x + sx * (y + sy * z)] = 1;
      }
    }
  }
  return out;
}

/**
 * The mask for a catalogue entry, computed once and kept on the entry.
 *
 * A def with no mesh, or one whose mask comes back completely empty, falls back
 * to fully solid.  Empty is the dangerous answer: it would make the block
 * invisible to every light ray, so a mistake in the ray cast would silently
 * turn the whole building transparent rather than throwing.  Solid is the safe
 * direction to be wrong in.
 */
export function maskFor(def) {
  if (def._solidity) return def._solidity;
  const size = def.size || [1, 1, 1];
  let m;
  if (!def.mesh || !def.mesh.faces || !def.mesh.faces.length) {
    m = new Uint8Array(size[0] * size[1] * size[2]).fill(1);
  } else {
    m = solidityMask(def.mesh, size);
    let any = 0;
    for (const v of m) any += v;
    if (!any) m = new Uint8Array(size[0] * size[1] * size[2]).fill(1);
  }
  def._solidity = m;
  return m;
}
