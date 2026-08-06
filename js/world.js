// world.js — the lattice.
//
// A sparse map from integer cell to placed block.  Two decisions in here are
// load-bearing and neither is obvious.
//
// 1. BLOCKS MAY SPAN SEVERAL CELLS, from day one.
//
// It is very tempting to make every block 1×1×1 and let the player compose an
// arch out of quarter-arch cells.  Do not.  An arch is a single structural act —
// its curve is struck about one centre, its voussoirs converge on that centre,
// and a 3-cell arch assembled from three independent cells has three centres and
// looks like it.  More to the point, capping every piece at one cell caps the
// building at toy scale forever, and the Carceri are the opposite of toy scale.
// So a block declares a size in cells, occupies a box of them, and the cells it
// covers hold a pointer back to the anchor.  Retro-fitting this later means
// rewriting placement, culling and removal at once, which is why it is here now.
//
// 2. FACES ARE CULLED BY COINCIDENCE, NOT BY A SOLIDITY MASK.
//
// The voxel-mesher move is to have each block declare which cell sides it fills
// and drop a face when the neighbour fills the opposite side.  That works for
// cubes and fails immediately here: a wall with an arch through it does not fill
// its cell side — it is a thin slab standing in the middle of it — so two
// adjacent arcade bays would each keep the membrane between them and a colonnade
// would read as a row of separate hoops instead of a tunnel.
//
// The rule that actually works is geometric: TWO FACES THAT OCCUPY THE SAME
// PLACE AND FACE OPPOSITE WAYS ARE BOTH INVISIBLE.  Hash each boundary face by
// its rounded world vertices; where two hashes collide with opposing normals,
// drop the pair.  It needs no declarations, it is exact, and it handles piers,
// wall slabs, floor plates, vault end-caps and multi-cell blocks with the same
// four lines.  Face culling here is an AESTHETIC feature, not an optimisation:
// it is what turns a row of bays into a receding tunnel.

import { maskFor } from './solidity.js';

export const SIDES = ['+x', '-x', '+y', '-y', '+z', '-z'];
export const OPPOSITE = { '+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y', '+z': '-z', '-z': '+z' };

/** Quarter-turns about the vertical map the four horizontal sides round; the
 *  two vertical sides never move.  Turning is the only transform a placed block
 *  gets — see mesh.js `turnY` on why nothing is ever mirrored. */
const TURN = ['+x', '+y', '-x', '-y'];
export function turnSide(side, q) {
  const i = TURN.indexOf(side);
  if (i < 0) return side;
  return TURN[(i + (((q % 4) + 4) % 4)) % 4];
}

export const key = (x, y, z) => `${x},${y},${z}`;
export const q4 = (q) => ((q % 4) + 4) % 4;

/** The inverse of the placement turn, on a cell offset — takes a world-relative
 *  cell back to the block-local one it came from.  Must stay the exact inverse
 *  of `mesh.js turnY`, or a rotated block's light holes end up in the wrong
 *  place and nothing says so. */
function unturnCell(dx, dy, q, sx, sy) {
  switch (q) {
    case 1: return [dy, sy - 1 - dx];
    case 2: return [sx - 1 - dx, sy - 1 - dy];
    case 3: return [sx - 1 - dy, dx];
    default: return [dx, dy];
  }
}

/**
 * THE TWO TIERS.  A cell holds one STRUCTURE and one FITTING.
 *
 * This exists because of a bug that was really a missing idea: the first scene
 * put a railing on a stair, the railing displaced the stair, and the plate came
 * back with handrails floating in mid-air over nothing.  One-block-per-cell
 * cannot express a handrail, a ring bolted to a pier, a lamp under a vault or a
 * balustrade on a landing — and those are not decoration in the Carceri, they
 * are half the subject.
 *
 * Two tiers, not N, because a building really does divide this way: you put up
 * the structure and then you fit it out.  A fitting never blocks light (a
 * railing does not shade a floor), never carries masonry coursing, and is the
 * first thing a click takes back.
 */
export const STRUCTURE = 'structure';
export const FITTING = 'fitting';
const anchorKey = (layer, x, y, z) => `${layer}|${x},${y},${z}`;

/** The footprint of a block as placed: odd quarter-turns swap x and y. */
export function placedSize(def, rot) {
  const [sx, sy, sz] = def.size || [1, 1, 1];
  return q4(rot) % 2 ? [sy, sx, sz] : [sx, sy, sz];
}

export class World {
  constructor(catalog) {
    this.catalog = catalog;
    /** "layer|x,y,z" → {x,y,z,id,rot,size,layer}.  One entry per BLOCK. */
    this.blocks = new Map();
    /** cell key → anchor key, STRUCTURE only.  What a block RESERVES: what a
     *  click hits, and what stops another block being dropped through it. */
    this.occupancy = new Map();
    /**
     * cell key → anchor key, STRUCTURE only, and only where the block's mesh
     * ACTUALLY HAS STONE.  This is the map the light marches through.
     *
     * A separate map because the two questions are different and conflating
     * them was costing the light model everything it was built for.  A block
     * has to reserve its whole box — a column that only claimed its own drum
     * would let you drop a wall through the middle of it — but a ray does not
     * care what a block reserves.  Measured before this existed: all eleven
     * primary forms occupied 27 cells of 27, including `bore-y`, which is a
     * tunnel you can see straight through.  So an arcade let no light through
     * its arches and a colonnade was as opaque as a wall.  See solidity.js.
     */
    this.solid = new Map();
    /** cell key → anchor key, FITTING only. */
    this.fittings = new Map();
    /**
     * ANCHOR SITE ID → the kind the player chose ('none' | 'ring' | 'torch').
     *
     * Kept on the WORLD and not on the block, because a block definition is
     * shared by every copy of it in the building — set a torch on one and the
     * whole catalogue entry would light up.  Keyed by the site's own stable
     * name (block position plus its index), so it survives a save, a reload and
     * a quarter-turn.
     *
     * A site the player has never touched is absent, which is different from
     * one set to 'none': absent means "still a red cube, still asking", and
     * 'none' means "asked and answered".
     */
    this.anchors = new Map();
    /** Bumped on every mutation.  The renderer watches it to know the plate is
     *  stale — a plate is re-bitten when the building changes, not redrawn
     *  every frame.  See engrave.js. */
    this.revision = 0;
  }

  get size() { return this.blocks.size; }
  get cellCount() { return this.occupancy.size; }
  *[Symbol.iterator]() { yield* this.blocks.values(); }

  layerOf(id) {
    const d = this.catalog.get(id);
    return d && d.layer === FITTING ? FITTING : STRUCTURE;
  }
  mapFor(layer) { return layer === FITTING ? this.fittings : this.occupancy; }

  /** The structure in this cell, or null. */
  at(x, y, z) {
    const a = this.occupancy.get(key(x, y, z));
    return a ? this.blocks.get(a) : null;
  }

  /** The fitting in this cell, or null. */
  fittingAt(x, y, z) {
    const a = this.fittings.get(key(x, y, z));
    return a ? this.blocks.get(a) : null;
  }

  /** Everything in this cell, fitting first — the order a click removes them. */
  allAt(x, y, z) {
    return [this.fittingAt(x, y, z), this.at(x, y, z)].filter(Boolean);
  }

  /** The cells a block would occupy if placed here.  Pure — used by the cursor
   *  to show a footprint before anything is committed. */
  footprint(x, y, z, id, rot = 0) {
    const def = this.catalog.get(id);
    if (!def) throw new Error(`no such block: ${id}`);
    const [sx, sy, sz] = placedSize(def, rot);
    const out = [];
    for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
      out.push([x + i, y + j, z + k]);
    }
    return out;
  }

  /** Blocks that would be displaced by this placement — SAME TIER ONLY.  A
   *  railing and the stair beneath it are not in competition. */
  obstructing(x, y, z, id, rot = 0) {
    const map = this.mapFor(this.layerOf(id));
    const hit = new Set();
    for (const [cx, cy, cz] of this.footprint(x, y, z, id, rot)) {
      const a = map.get(key(cx, cy, cz));
      if (a) hit.add(a);
    }
    return [...hit].map((a) => this.blocks.get(a)).filter(Boolean);
  }

  /**
   * Place a block.  Anything it overlaps in its own tier is removed first — a
   * builder that refuses is a builder you fight, and this game has no economy
   * to protect.
   * @returns the blocks that were displaced.
   */
  place(x, y, z, id, rot = 0) {
    const layer = this.layerOf(id);
    const displaced = this.obstructing(x, y, z, id, rot);
    for (const b of displaced) this.removeBlock(b);
    const rec = { x, y, z, id, rot: q4(rot), layer, size: placedSize(this.catalog.get(id), rot) };
    const anchor = anchorKey(layer, x, y, z);
    const map = this.mapFor(layer);
    this.blocks.set(anchor, rec);
    const cells = this.footprint(x, y, z, id, rot);
    for (const [cx, cy, cz] of cells) map.set(key(cx, cy, cz), anchor);
    if (layer === STRUCTURE) {
      const def = this.catalog.get(id);
      const mask = maskFor(def);
      const [msx, msy] = def.size || [1, 1, 1];
      const q = q4(rot);
      for (const [cx, cy, cz] of cells) {
        // Back out the block-local cell, undoing the placement turn, so the
        // mask is stored once per def and read through the rotation rather
        // than recomputed four times.
        const [lx, ly] = unturnCell(cx - x, cy - y, q, msx, msy);
        if (mask[lx + msx * (ly + msy * (cz - z))]) this.solid.set(key(cx, cy, cz), anchor);
      }
    }
    this.revision++;
    return displaced;
  }

  /** Remove from this cell — the FITTING first if there is one, else the
   *  structure.  Pointing at any cell of a block removes the whole block, which
   *  is the only behaviour that is not infuriating when the thing you clicked
   *  is four cells long. */
  remove(x, y, z) {
    const b = this.fittingAt(x, y, z) || this.at(x, y, z);
    if (!b) return null;
    this.removeBlock(b);
    this.revision++;
    return b;
  }

  removeBlock(b) {
    const anchor = anchorKey(b.layer, b.x, b.y, b.z);
    this.forgetAnchorsAt(b);
    const map = this.mapFor(b.layer);
    this.blocks.delete(anchor);
    for (const [cx, cy, cz] of this.footprint(b.x, b.y, b.z, b.id, b.rot)) {
      const k = key(cx, cy, cz);
      if (map.get(k) === anchor) map.delete(k);
      if (this.solid.get(k) === anchor) this.solid.delete(k);
    }
  }

  clear() {
    this.blocks.clear(); this.occupancy.clear(); this.fittings.clear();
    this.solid.clear(); this.anchors.clear(); this.revision++;
  }

  /* ------------------------------------------------------------ anchors -- */

  anchorKind(id) { return this.anchors.get(id); }

  setAnchorKind(id, kind) {
    if (kind == null) this.anchors.delete(id);
    else this.anchors.set(id, kind);
    this.revision++;
    return kind;
  }

  /** Forget the choices made on a block that is no longer there.  Without this
   *  a save accumulates settings for sites that do not exist, and — worse —
   *  putting a different block back in the same place inherits them. */
  forgetAnchorsAt(b) {
    const stem = `${anchorKey(b.layer, b.x, b.y, b.z)}#`;
    for (const k of this.anchors.keys()) if (k.startsWith(stem)) this.anchors.delete(k);
  }

  bounds() {
    if (!this.blocks.size) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const b of this.blocks.values()) {
      for (let d = 0; d < 3; d++) {
        const a = [b.x, b.y, b.z][d];
        lo[d] = Math.min(lo[d], a);
        hi[d] = Math.max(hi[d], a + b.size[d]);
      }
    }
    return { lo, hi };
  }

  /* --------------------------------------------------------------- saves -- */
  /* Plain data, sorted, so two identical buildings serialise to identical text
   * and a diff of two saves is a diff of two buildings. */

  toJSON() {
    const cells = [...this.blocks.values()]
      .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
      .map((c) => (c.rot ? [c.x, c.y, c.z, c.id, c.rot] : [c.x, c.y, c.z, c.id]));
    const anchors = [...this.anchors.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return anchors.length
      ? { format: 'piranesi/2', cells, anchors }
      : { format: 'piranesi/2', cells };
  }

  static fromJSON(catalog, data) {
    const w = new World(catalog);
    for (const [x, y, z, id, rot] of data.cells || []) {
      if (catalog.has(id)) w.place(x, y, z, id, rot || 0);
    }
    // AFTER the blocks, always: `place` calls `forgetAnchorsAt`, so loading the
    // choices first would have the building erase them as it went up.
    for (const [id, kind] of data.anchors || []) w.anchors.set(id, kind);
    return w;
  }
}
