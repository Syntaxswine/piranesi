// anchors.js — ANCHOR POINTS.  The secondary tier, and the only thing in the
// game the player configures rather than places.
//
// THE OWNER'S SPEC, in two parts.  What they are:
//
//   "anchor points are special features that are defined by what is near them,
//    if a solid brick wall with an anchor point has another solid wall placed
//    in front of that anchor point it wont even be visible because it wont be
//    considered a viable point so you don't have to render it.  but if you do
//    have viable anchor points they should connect to other anchor points on
//    other blocks, perhaps with ropes or hanging chains."
//
// And how you set them:
//
//   "my gut says that what they are should be player selected.  start them off
//    as a red cube that can be clicked on to select, 'none, torch, ring'.
//    there might be other options later but for now rings and torches will be
//    plenty, like perhaps they could be even something like a small alcove, or
//    piece of wall art."
//
// SO THERE ARE THREE STATES AND THEY ARE DRAWN THREE DIFFERENT WAYS.
//
//   unset     a red cube.  CHROME, not geometry — drawn over the finished plate
//             by the 2-D context, depth-tested against the stencil so a wall in
//             front of it hides it.  It is a UI affordance, it must be crisp,
//             it must be clickable, and it must not cost a re-bite of the plate
//             when the mouse moves.
//   set       real geometry in the FITTING tier: a ring, a torch.  Bitten into
//             the plate like anything else, because now it is part of the
//             building rather than part of the editor.
//   none      the player has said no.  Nothing is drawn at all, and the red
//             cube does not come back.  "none" is a decision, not a reset.
//
// AND A SITE THAT IS NOT VIABLE IS NONE OF THE THREE.  It is not drawn, not
// clickable, and not offered — but it is not forgotten either: pull the wall
// away and it comes back with whatever kind it had.  That is what "defined by
// what is near them" has to mean in a game where the near things move.

import { Mesh, box, sweep, arc, lathe, translate } from './mesh.js';
import { SUB, FOOT, SECONDARY } from './cube.js';
import { pointOf, normalOf, samplerStamp, SAMPLER } from './stack.js';
import { key as cellKey, q4, turnSide, anchorSite, isIndexKey } from './world.js';

const S = SUB;

/** The kinds a player may choose, in the order the picker offers them. */
export const KINDS = [
  { id: 'none', name: 'none', note: 'leave it bare' },
  { id: 'ring', name: 'ring', note: 'iron; chains hang from these' },
  { id: 'torch', name: 'torch', note: 'a bracket and a flame' },
];
export const KIND_IDS = KINDS.map((k) => k.id);

/* ------------------------------------------------------------ addressing -- */

/**
 * A stable name for one site: the block it belongs to, and WHERE ON IT.
 *
 * It used to be the site's index in the block's own list, which survives a save,
 * a reload and a quarter-turn — and not the one thing that actually moves. See
 * `world.js anchorSite`: the list is dealt by a seeded shuffle, so its indices
 * are positions in a generated thing and this project has a law about those.
 *
 * The declaration is in the block's LOCAL frame, before the placement turn, so a
 * turned block's torches stay on the wall they were bolted to. (`siteWorld`
 * turns the point and the normal; it does not turn the name.)
 */
export const siteId = (b, a) => anchorSite(b.layer, b.x, b.y, b.z, a);

/**
 * A site in world coordinates, for a placed block.
 *
 * The local point and the local normal go through the SAME quarter-turn the
 * mesh does, and the side tag through `turnSide`. Deriving the world position
 * any other way is how a turned block ends up with its torches on the wrong
 * wall — which looks entirely plausible until you turn the block back.
 */
export function siteWorld(def, b, i) {
  const a = def.anchors[i];
  const p = pointOf(a);
  const n = normalOf(a.side);
  const q = q4(b.rot || 0);
  const [px, py] = turnXY(p[0], p[1], q, S, S);
  const [nx, ny] = turnDir(n[0], n[1], q);
  return {
    id: siteId(b, a),
    block: b,
    index: i,
    kind: a.kind,
    side: turnSide(a.side, q),
    p: [b.x + px, b.y + py, b.z + p[2]],
    n: [nx, ny, 0],
  };
}

/** The same quarter-turn `mesh.js turnY` applies to a vertex. */
function turnXY(x, y, q, sx, sy) {
  switch (q) {
    case 1: return [sy - y, x];
    case 2: return [sx - x, sy - y];
    case 3: return [y, sx - x];
    default: return [x, y];
  }
}
/** …and to a direction, which has no origin to be reflected about. */
function turnDir(x, y, q) {
  switch (q) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}

/* -------------------------------------------------------------- viability -- */

/**
 * IS THERE ROOM IN FRONT OF IT?
 *
 * One lookup in the solidity map — the cell the site faces into. If that cell
 * holds stone, the site is buried and there is nothing to see, nothing to
 * click, and nothing to hang a chain from.
 *
 * The SOLIDITY map, not the occupancy map: a block reserves its whole box but
 * is mostly hole, so asking occupancy would call a torch buried whenever the
 * neighbouring block existed at all, however much daylight was actually in
 * front of it. See world.js.
 */
export function viable(world, site) {
  const [x, y, z] = site.p;
  const n = site.n;
  // Step a third of a yard out and read the cell there. Half a yard would land
  // on the boundary plane between two cells, which is exactly the seam this has
  // to be decisive about.
  const cx = Math.floor(x + n[0] * 0.34);
  const cy = Math.floor(y + n[1] * 0.34);
  const cz = Math.floor(z);
  const hit = (world.solid || world.occupancy).get(cellKey(cx, cy, cz));
  if (!hit) return true;
  // Its own block does not bury it. A face's site sits ON the boundary, so the
  // cell in front is the neighbour's — unless the block is one deep and the
  // rounding put us back inside ourselves.
  return hit === `${site.block.layer || 'structure'}|${site.block.x},${site.block.y},${site.block.z}`;
}

/**
 * Every site in the world, with its viability resolved.
 *
 * Rebuilt whole on a world change rather than patched incrementally. Placing a
 * block can bury or expose sites on any of its six neighbours, removing one can
 * expose sites two blocks away through a bore, and an incremental update that
 * is wrong leaves a torch burning inside a wall with nothing to say so. The
 * whole sweep is a map lookup per site.
 */
export function survey(world, catalog) {
  if (world.indexed) reindex(world, catalog);
  const out = [];
  for (const b of world.blocks.values()) {
    const def = catalog.get(b.id);
    if (!def || !def.anchors || !def.anchors.length) continue;
    for (let i = 0; i < def.anchors.length; i++) {
      const s = siteWorld(def, b, i);
      s.kind = world.anchorKind(s.id) ?? def.anchors[i].kind ?? null;
      s.viable = viable(world, s);
      out.push(s);
    }
  }
  return out;
}

/**
 * BRING A `piranesi/3` FILE'S ANCHOR CHOICES ACROSS — or refuse to, out loud.
 *
 * An old key names a site by its index in the list `stack.js anchorsFor` deals,
 * so the translation is "ask today's sampler what it deals and take the i-th".
 * That is exact while today's sampler is the one that wrote the file, and a
 * catastrophe the day it is not: every torch in every save moves to a different
 * bracket with nothing anywhere saying so.
 *
 * So it is GATED on a pinned stamp of the sampler's actual output. If the
 * sampler has moved, nothing is rewritten, the old keys stay exactly where they
 * are, and `world.anchorNote` says why — an index that fails visibly beats a
 * migration that lies. See `stack.js samplerStamp`.
 *
 * Called from `survey`, which is the one place every path that can SEE an anchor
 * goes through, so no caller has to remember.
 */
export function reindex(world, catalog, stamp = samplerStamp()) {
  world.indexed = 0;                     // whatever happens, do not try twice
  if (stamp !== SAMPLER) {
    world.anchorNote = 'this building names its anchors the old way and the sampler has '
      + 'changed since — the choices are kept as they are rather than moved to the wrong walls';
    return 0;
  }
  let moved = 0, lost = 0;
  for (const [id, kind] of [...world.anchors.entries()]) {
    if (!isIndexKey(id)) continue;
    const hash = id.lastIndexOf('#');
    const stem = id.slice(0, hash);
    const i = Number(id.slice(hash + 1));
    const b = world.blocks.get(stem);
    const def = b && catalog.get(b.id);
    const a = def && def.anchors && def.anchors[i];
    world.anchors.delete(id);
    // A site the block no longer offers is dropped, not guessed at — the same
    // rule `forgetAnchorsAt` applies when the block itself goes.
    if (!a) { lost++; continue; }
    world.anchors.set(siteId(b, a), kind);
    moved++;
  }
  if (moved || lost) {
    world.anchorNote = `${moved} anchor choice(s) moved to the new naming`
      + (lost ? `; ${lost} named a site this build's blocks no longer have` : '');
  }
  return moved;
}

/* ------------------------------------------------------------- the pieces -- */

const cache = new Map();

/** The geometry for a chosen kind, facing `+y`, in a block-local frame with the
 *  wall at y = 0. Cached: there are two of them and thousands of sites. */
export function fittingMesh(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const m = kind === 'ring' ? ringMesh() : kind === 'torch' ? torchMesh() : null;
  if (m) m.finish();
  cache.set(kind, m);
  return m;
}

/** An iron ring on a stub, the thing a chain is shackled to. Sized in FEET,
 *  because ironmongery is: a ring is about eight inches across. */
function ringMesh() {
  const m = new Mesh();
  const stub = 4 * FOOT / 12;
  box(m, [-0.09, 0, -0.09], [0.09, stub, 0.09], { mat: 'iron', tag: 'anchor-stub' });
  // The ring itself, laid in the vertical plane and hanging off the stub.
  const R = 8 * FOOT / 12 / 2;
  const seg = 14, tube = 0.05;
  const prof = arc(0, 0, tube, 0, Math.PI * 2 * (1 - 1 / 8), 7);
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(t0) * R, stub + 0.02, Math.sin(t0) * R - R];
    const p1 = [Math.cos(t1) * R, stub + 0.02, Math.sin(t1) * R - R];
    strutBetween(m, p0, p1, tube);
  }
  void prof; void lathe; void sweep; void translate;
  return m;
}

/** A bracket with a cresset on it. The flame is not modelled — smoke and fire
 *  are the one thing this renderer has no register for, and a hard-edged
 *  polygonal flame would be worse than none. */
function torchMesh() {
  const m = new Mesh();
  box(m, [-0.07, 0, -0.10], [0.07, 0.12, 0.34], { mat: 'iron', tag: 'anchor-plate' });
  strutBetween(m, [0, 0.10, 0.10], [0, 0.62, 0.46], 0.055);   // the arm
  strutBetween(m, [0, 0.10, 0.30], [0, 0.50, 0.44], 0.04);    // the stay
  // The cresset: a small basket, wider at the top.
  const cup = [[0.10, 0], [0.22, 0.34], [0.24, 0.40]];
  lathe(m, 0, 0.62, cup.map(([r, z]) => [r, 0.44 + z]), 10, { mat: 'iron', tag: 'cresset' });
  return m;
}

/** A square-section bar between two points. `mesh.strut` wants a radius and a
 *  material and does exactly this; kept local so the piece sizes read together. */
function strutBetween(m, p0, p1, r) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const dir = [d[0] / L, d[1] / L, d[2] / L];
  const seed = Math.abs(dir[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const a = norm(cross(seed, dir));
  const b = cross(dir, a);
  const at = (p, sa, sb) => m.vert([
    p[0] + a[0] * sa * r + b[0] * sb * r,
    p[1] + a[1] * sa * r + b[1] * sb * r,
    p[2] + a[2] * sa * r + b[2] * sb * r,
  ]);
  const A = [at(p0, -1, -1), at(p0, 1, -1), at(p0, 1, 1), at(p0, -1, 1)];
  const B = [at(p1, -1, -1), at(p1, 1, -1), at(p1, 1, 1), at(p1, -1, 1)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    m.face([A[i], A[j], B[j], B[i]], { mat: 'iron', u: dir, vDir: a, hatch: 'u', tag: 'iron' });
  }
  m.face(A.slice().reverse(), { mat: 'iron', u: a, vDir: b, tag: 'iron' });
  m.face(B.slice(), { mat: 'iron', u: a, vDir: b, tag: 'iron' });
}

const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const norm = (v) => { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

/**
 * A placed fitting, as a drawable the engraver can take: the kind's mesh turned
 * to face out of its wall and moved to the site.
 */
export function fittingAt(site) {
  const base = fittingMesh(site.kind);
  if (!base) return null;
  const n = site.n;
  // The pieces are modelled facing +y, so the turn is the one that takes +y to
  // this face's normal. Four cases, no trigonometry, no chance of a mirror.
  const q = n[1] > 0.5 ? 2 : n[1] < -0.5 ? 0 : n[0] > 0.5 ? 1 : 3;
  const m = new Mesh();
  m.merge(base, (p) => {
    const [x, y] = turnDir(p[0], p[1], q);
    return [site.p[0] + x, site.p[1] + y, site.p[2] + p[2]];
  });
  m.finish();
  return m;
}

export const TIER = SECONDARY;
