// modules.js - the cube.
//
// THE CUBE IS THE UNIT OF AUTHORSHIP.  A cube is 6 cells on a side - twelve
// metres - and it holds a whole detailed piece of architecture: piers with their
// coursing, an arcade with its imposts, a vault with its intrados, the railings
// and rings and lamps.  The player assembles cubes.  The fine block catalogue in
// blocks.js does not go away; it is demoted to being the MATERIAL a cube is made
// of, which is where it belongs.  Nobody builds a prison one voussoir at a time.
//
// A cube is exactly a very large block, so the lattice, the coincidence culling,
// the light marching, the picking and the saves all work unchanged.  That is not
// a coincidence - `World` was written against "anything with a size and a mesh",
// and a cube is a thing with a size and a mesh.
//
// TWO WAYS TO AUTHOR ONE, and the second is the interesting one:
//
//   1. COMPOSE.  Stamp catalogue blocks at local cell coordinates.  Good for
//      anything built OF pieces: an arcade, a scaffold, a stair.
//
//   2. SLICE.  Generate a form far larger than one cube and keep only the part
//      inside this cube.  A forty-eight-metre barrel vault is not four small
//      vaults in a row; it is one arc struck about one centre, cut by the cube
//      grid into eight tiles.  The tiles fit BY CONSTRUCTION - two neighbours
//      evaluate the same arc at the same boundary, so their cut faces coincide
//      exactly and the existing coincidence rule cancels them.  The seam is not
//      hidden, it is not there.
//
// That second path is what lets the catalogue hold objects bigger than its own
// unit: a great vault as a 4x2 sheet of tiles, a half vault as two columns of
// 1x2, a triumphal arch as whatever it needs.  Cut the same arc a different way
// and you get a different kit out of the same generator.

import { Mesh, box, arc, lathe, strut, turnY } from './mesh.js';
import { buildCatalog } from './blocks.js';

/** Cells along one edge of a cube.  6 cells = 12 m. */
export const MODULE = 6;
/** Metres, for the HUD. */
export const MODULE_METRES = MODULE * 2;

const blocks = buildCatalog();

/* ============================================================ the two paths */

/** COMPOSE: stamp a catalogue block into a module at local cell coordinates. */
function put(m, x, y, z, id, rot = 0) {
  const def = blocks.get(id);
  if (!def) throw new Error(`no such block: ${id}`);
  const [ax, ay] = def.size;
  const turn = turnY(rot, ax, ay);
  m.merge(def.mesh, (p) => {
    const q = turn(p);
    return [q[0] + x, q[1] + y, q[2] + z];
  });
  return m;
}

/**
 * SLICE: one cube's worth of a barrel vault whose span is many cubes.
 *
 * The section is a rectangle with a semicircular bite out of the bottom, struck
 * about a single centre at (span/2, 0).  Material is everything above the arc
 * and below `height`.  This emits only the part falling inside the window
 * x in [ix*S, (ix+1)*S], z in [iz*S, (iz+1)*S], expressed in LOCAL coordinates.
 *
 * Three face groups come out of it, and each one has a job:
 *   - the two END faces (y = 0 and y = depth), which cancel against the next
 *     bay along the tunnel and are what makes a run of these a tunnel;
 *   - the CUT faces at the x and z window boundaries, which cancel against the
 *     neighbouring tile of the same vault;
 *   - the INTRADOS, the curved underside, which is the only surface a person
 *     standing underneath actually sees.
 *
 * Because both neighbours evaluate the same arc at the same boundary, the cut
 * faces are bit-identical and vanish.  Nothing needs to know it is a tile.
 */
function vaultSlice(m, o) {
  const { span, height, depth = MODULE, S = MODULE, ix, iz } = o;
  const mat = o.mat || 'stone';
  const soffit = o.soffit || 'plaster';
  const r = span / 2;
  const X0 = ix * S, X1 = (ix + 1) * S;
  const Z0 = iz * S, Z1 = (iz + 1) * S;
  /** Height of the arc's underside at x.  Outside the springing there is no
   *  bite at all and the section is solid to the ground. */
  const arcZ = (x) => {
    const d = x - r;
    return Math.abs(d) >= r ? 0 : Math.sqrt(r * r - d * d);
  };

  const hi = Math.min(Z1, height);
  if (hi <= Z0 + 1e-6) return m;
  const L = (x) => x - X0, V = (z) => z - Z0;        // world -> local

  // COLUMNS SHARE THEIR VERTICES.  This is not a memory optimisation: the edge
  // table in mesh.js keys on vertex INDEX, so two quads that merely happen to
  // occupy the same edge - rather than literally referencing the same two
  // vertices - are two separate surfaces with a border edge between them, and
  // a border edge is always drawn.  Allocating a fresh `vert` per column ruled
  // a line down every one of the ninety-six columns across the span, on both
  // the section and the intrados: the vault came back looking like a paling
  // fence.  Build the boundaries once, index into them.
  //
  // AND THE COLUMN BOUNDARIES INCLUDE THE ARC'S WINDOW CROSSINGS.  The arc
  // enters and leaves this tile at x = r +/- sqrt(r^2 - z^2) for z = Z0 and
  // z = hi.  If those crossings fall inside a column, that column is half
  // curve and half nothing, and clamping it to the window turns the curve into
  // a horizontal lid: a solid black band hanging across the open middle of the
  // vault, exactly at the tile seam, reading as a construction joint in a form
  // that has none.  Putting the crossings ON boundaries means no column ever
  // needs clamping and every column is wholly inside or wholly outside.
  const N = S * 4;                                   // four columns per cell
  const cuts = new Set();
  for (let i = 0; i <= N; i++) cuts.add(X0 + (i / N) * S);
  for (const z of [Z0, hi]) {
    if (z <= r) {
      const d = Math.sqrt(Math.max(0, r * r - z * z));
      for (const x of [r - d, r + d]) if (x > X0 + 1e-9 && x < X1 - 1e-9) cuts.add(x);
    }
  }
  const xs = [...cuts].sort((a, b) => a - b).filter((x) => x <= span + 1e-9);
  if (xs.length < 2) return m;
  const n = xs.length;
  /** Clamped to the window, for the flat faces. */
  const za = xs.map((x) => Math.max(Z0, Math.min(arcZ(x), hi)));
  /** Unclamped, so the intrados can tell "the curve is elsewhere" from
   *  "the curve is flat here". */
  const raw = xs.map(arcZ);

  const a0 = [], b0 = [], ad = [], bd = [];
  for (let i = 0; i < n; i++) {
    a0.push(m.vert([L(xs[i]), 0, V(za[i])]));
    b0.push(m.vert([L(xs[i]), 0, V(hi)]));
    ad.push(m.vert([L(xs[i]), depth, V(za[i])]));
    bd.push(m.vert([L(xs[i]), depth, V(hi)]));
  }

  // --- the two ends of the bay: they cancel against the next bay along ----
  for (let i = 0; i < n - 1; i++) {
    if (hi - Math.min(za[i], za[i + 1]) < 1e-6) continue;
    m.face([a0[i], a0[i + 1], b0[i + 1], b0[i]], {
      mat, u: [1, 0, 0], vDir: [0, 0, 1], hatch: 'v', side: '-y', tag: 'section',
    });
    m.face([bd[i], bd[i + 1], ad[i + 1], ad[i]], {
      mat, u: [1, 0, 0], vDir: [0, 0, 1], hatch: 'v', side: '+y', tag: 'section',
    });
  }

  // --- the intrados: the curved underside, the only surface anyone is under -
  for (let i = 0; i < n - 1; i++) {
    // The curve must be genuinely INSIDE this window across the whole column,
    // judged on the unclamped arc. Below the window there is no vault here;
    // above it, the vault is in the tile overhead.
    const lo = Math.min(raw[i], raw[i + 1]), up = Math.max(raw[i], raw[i + 1]);
    if (up <= Z0 + 1e-6) continue;
    if (lo >= hi - 1e-6) continue;
    const dx = xs[i + 1] - xs[i], dz = za[i + 1] - za[i];
    const len = Math.hypot(dx, dz) || 1;
    m.face([a0[i], ad[i], ad[i + 1], a0[i + 1]], {
      mat: soffit,
      u: [0, 1, 0], vDir: [dx / len, 0, dz / len],
      hatch: 'v', tag: 'intrados',
      // The strokes wrap the barrel - see engrave.js LAYERS.  This is the one
      // surface in the whole catalogue that must keep its own frame.
      form: true,
    });
  }

  // --- the cut faces, which cancel against the neighbouring TILE ----------
  if (hi - za[0] > 1e-6) {
    m.face([ad[0], a0[0], b0[0], bd[0]], { mat, u: [0, 1, 0], vDir: [0, 0, 1], hatch: 'v', side: '-x', tag: 'cut' });
  }
  if (hi - za[n - 1] > 1e-6) {
    m.face([a0[n - 1], ad[n - 1], bd[n - 1], b0[n - 1]], { mat, u: [0, 1, 0], vDir: [0, 0, 1], hatch: 'v', side: '+x', tag: 'cut' });
  }

  // A column where the arc has already reached the top of this window holds NO
  // MATERIAL AT ALL - the void passes straight through the tile.  Every face
  // group has to honour that.  Missing it on the extrados alone drew a lid
  // across the open middle of the vault: a solid black band hanging in the air
  // exactly at the tile seam, which reads as a construction joint in a form
  // that has none.
  const solid = (i) => hi - Math.max(za[i], za[i + 1]) > 1e-6;

  // Top: the extrados of the vault, or the cut meeting the tile above.
  const capSide = Math.abs(hi - Z1) < 1e-6 ? '+z' : null;
  for (let i = 0; i < n - 1; i++) {
    if (!solid(i)) continue;
    m.face([b0[i], b0[i + 1], bd[i + 1], bd[i]], {
      mat, u: [1, 0, 0], vDir: [0, 1, 0], hatch: 'u', side: capSide, tag: 'extrados',
    });
  }

  // Underside where the section is solid to the cut - the tile below's ceiling.
  if (iz > 0) {
    for (let i = 0; i < n - 1; i++) {
      if (!solid(i)) continue;
      if (za[i] > Z0 + 1e-6 || za[i + 1] > Z0 + 1e-6) continue;
      m.face([a0[i], ad[i], ad[i + 1], a0[i + 1]], {
        mat, u: [1, 0, 0], vDir: [0, 1, 0], hatch: 'u', side: '-z', tag: 'cut',
      });
    }
  }
  return m;
}

/* ================================================================ catalogue */

const defs = [];
/**
 * @param o {id, name, family, note, faces, build}
 *   faces  what each side of the cube presents, for the join audit
 *   tiles  [w,d,h] in CUBES for a compound; `build` then takes (m,i,j,k)
 */
const mod = (o) => { defs.push(o); return o; };

/** The six sides a cube can present.  `open` matches anything. */
export const CONNECTORS = ['hall', 'arcade', 'wall', 'deck', 'shaft', 'open'];

/* ---- the workhorse bays -------------------------------------------------- */

mod({
  id: 'bay', name: 'Vaulted bay', family: 'hall',
  faces: { '+y': 'hall', '-y': 'hall', '+x': 'arcade', '-x': 'arcade', '+z': 'wall', '-z': 'deck' },
  note: 'The unit of the prison. Paved floor, an arcade down each side with a four-metre arch in it, and a vault springing at four metres over an eight-metre span. Lay them in a row and the ends cancel: that is the tunnel.',
  build: (m) => {
    for (let y = 0; y < MODULE; y++) {
      for (let x = 0; x < MODULE; x++) put(m, x, y, 0, 'paving');
      for (const wx of [0, 5]) {
        // Pier, arch, pier: the arcade rhythm, one arch to a cube.
        if (y === 2) put(m, wx, y, 1, 'arch-2', 1);
        else if (y !== 3) { put(m, wx, y, 1, 'pier'); put(m, wx, y, 2, 'pier'); }
        put(m, wx, y, 3, 'cornice');
        put(m, wx, y, 4, 'ashlar');
        put(m, wx, y, 5, 'ashlar');
      }
      put(m, 1, y, 3, 'vault-4');
    }
    put(m, 0, 1, 2, 'ring', 3);
    return m;
  },
});

mod({
  id: 'bay-open', name: 'Open bay', family: 'hall',
  faces: { '+y': 'hall', '-y': 'hall', '+x': 'open', '-x': 'open', '+z': 'wall', '-z': 'deck' },
  note: 'The same vault carried on isolated piers with nothing between them. Use it where the hall crosses another, or where you want to see a long way sideways.',
  build: (m) => {
    for (let y = 0; y < MODULE; y++) {
      for (let x = 0; x < MODULE; x++) put(m, x, y, 0, 'paving');
      for (const wx of [0, 5]) {
        if (y === 0 || y === 5) { put(m, wx, y, 1, 'pier'); put(m, wx, y, 2, 'pier'); }
        put(m, wx, y, 3, 'cornice');
        put(m, wx, y, 4, 'ashlar'); put(m, wx, y, 5, 'ashlar');
      }
      put(m, 1, y, 3, 'vault-4');
    }
    return m;
  },
});

mod({
  id: 'mass', name: 'Solid mass', family: 'mass',
  faces: { '+y': 'wall', '-y': 'wall', '+x': 'wall', '-x': 'wall', '+z': 'wall', '-z': 'wall' },
  note: 'Twelve metres of rusticated stone with a cornice on top. The repoussoir: crop one of these at the edge of the frame and everything behind it acquires depth.',
  build: (m) => {
    for (let x = 0; x < MODULE; x++) for (let y = 0; y < MODULE; y++) {
      for (let z = 0; z < MODULE - 1; z++) put(m, x, y, z, 'pier');
      put(m, x, y, MODULE - 1, 'cornice');
    }
    put(m, 0, 2, 3, 'ring', 3);
    put(m, 0, 4, 4, 'ring', 3);
    return m;
  },
});

mod({
  id: 'buttress', name: 'Buttressed wall', family: 'mass',
  faces: { '+y': 'wall', '-y': 'wall', '+x': 'wall', '-x': 'open', '+z': 'wall', '-z': 'wall' },
  note: 'A wall two cells thick with a raking shore leaning on it and rubble at its foot. What holds a ruin up.',
  build: (m) => {
    for (let y = 0; y < MODULE; y++) for (let z = 0; z < MODULE; z++) {
      put(m, 4, y, z, 'brick'); put(m, 5, y, z, 'brick');
    }
    for (let y = 0; y < MODULE; y++) put(m, 3, y, MODULE - 1, 'cornice');
    put(m, 1, 1, 0, 'raking-shore'); put(m, 1, 4, 0, 'raking-shore');
    put(m, 2, 2, 0, 'rubble'); put(m, 3, 3, 0, 'rubble', 1); put(m, 2, 4, 0, 'rubble', 2);
    return m;
  },
});

/* ---- circulation --------------------------------------------------------- */

mod({
  id: 'stair', name: 'Great flight', family: 'walk',
  faces: { '+y': 'deck', '-y': 'deck', '+x': 'open', '-x': 'open', '+z': 'open', '-z': 'deck' },
  note: 'One straight flight climbing a whole cube - twelve metres up over twelve along, two cells wide, railed both sides. It arrives exactly on the deck of the cube above and beyond.',
  build: (m) => {
    for (let i = 0; i < MODULE; i++) {
      put(m, 2, i, i, 'stair-steep'); put(m, 3, i, i, 'stair-steep');
      put(m, 2, i, i, 'rail-steep'); put(m, 3, i, i, 'rail-steep', 2);
    }
    for (let x = 1; x < 5; x++) put(m, x, 0, 0, 'paving');
    put(m, 1, 0, 0, 'pier'); put(m, 4, 0, 0, 'pier');
    return m;
  },
});

mod({
  id: 'gallery', name: 'Gallery and catwalk', family: 'walk',
  faces: { '+y': 'deck', '-y': 'deck', '+x': 'wall', '-x': 'open', '+z': 'open', '-z': 'open' },
  note: 'A plank catwalk on braced gantries, hung against a wall with nothing under it. Half the Carceri is people standing on one of these.',
  build: (m) => {
    for (let y = 0; y < MODULE; y++) for (let z = 0; z < MODULE; z++) put(m, 5, y, z, 'brick');
    for (let y = 0; y < MODULE; y++) {
      put(m, 3, y, 3, 'catwalk', 1); put(m, 4, y, 3, 'catwalk', 1);
      put(m, 3, y, 3, 'railing', 1);
    }
    for (const y of [0, 3]) { put(m, 3, y, 1, 'gantry'); put(m, 4, y, 1, 'gantry'); }
    put(m, 2, 2, 4, 'beam', 1);
    put(m, 4, 4, 4, 'lamp');
    return m;
  },
});

mod({
  id: 'well', name: 'The well', family: 'walk',
  faces: { '+y': 'deck', '-y': 'deck', '+x': 'deck', '-x': 'deck', '+z': 'shaft', '-z': 'shaft' },
  note: 'A paved floor with a square shaft straight through it, balustraded all round, a chain over the void and a lamp above. The vertical connection, and the one place the eye is allowed to fall.',
  build: (m) => {
    for (let x = 0; x < MODULE; x++) for (let y = 0; y < MODULE; y++) {
      const inShaft = x >= 2 && x <= 3 && y >= 2 && y <= 3;
      if (!inShaft) put(m, x, y, 0, 'paving');
    }
    for (const x of [2, 3]) { put(m, x, 1, 1, 'balustrade'); put(m, x, 4, 1, 'balustrade', 2); }
    for (const y of [2, 3]) { put(m, 1, y, 1, 'balustrade', 1); put(m, 4, y, 1, 'balustrade', 3); }
    put(m, 2, 2, 4, 'ring', 1);
    put(m, 3, 3, 5, 'lamp');
    for (let z = 1; z < MODULE; z++) { put(m, 0, 0, z, 'pier'); put(m, 5, 5, z, 'pier'); }
    return m;
  },
});

mod({
  id: 'tower', name: 'Round tower', family: 'round',
  faces: { '+y': 'wall', '-y': 'wall', '+x': 'wall', '-x': 'wall', '+z': 'wall', '-z': 'wall' },
  note: 'A drum rising the full cube with a gallery corbelled round it. Plate III. Stack them and the flanks find their own silhouette every frame, because a cylinder has no modelled outline.',
  build: (m) => {
    for (let z = 0; z < MODULE; z++) {
      for (let x = 1; x < 5; x++) for (let y = 1; y < 5; y++) {
        const dx = x - 2.5, dy = y - 2.5;
        if (dx * dx + dy * dy <= 4.1) put(m, x, y, z, z === 3 ? 'cornice' : 'drum');
      }
    }
    for (const [x, y, r] of [[1, 0, 0], [4, 0, 0], [1, 5, 2], [4, 5, 2]]) put(m, x, y, 4, 'balustrade', r);
    put(m, 2, 0, 4, 'catwalk'); put(m, 3, 0, 4, 'catwalk');
    return m;
  },
});

/* ---- the sliced forms: objects larger than the cube ---------------------- */

/**
 * THE GREAT VAULT.  Span four cubes - forty-eight metres - rising two.
 * Eight tiles, cut from one arc struck about one centre.
 *
 * This is the thing a single-cube catalogue cannot express.  Four separate
 * one-cube vaults in a row are four arcs about four centres and they read as
 * four arcs; this is one arc, and the player builds it four cubes at a time.
 */
mod({
  id: 'great-vault', name: 'Great vault, 48 m', family: 'vault',
  tiles: [4, 1, 3],
  faces: { '+y': 'hall', '-y': 'hall', '+x': 'wall', '-x': 'wall', '+z': 'wall', '-z': 'wall' },
  note: 'One arc, forty-eight metres across, cut by the cube grid into a 4x3 sheet. Neighbouring tiles evaluate the same arc at the same boundary, so their cut faces coincide exactly and cancel: the seam is not hidden, it is not there.',
  // THE SHEET IS THREE CUBES TALL FOR A TWO-CUBE RISE.  A semicircular arch of
  // span S rises S/2, so a 4-cube span crowns exactly two cubes up - and a
  // sheet only two cubes tall therefore has ZERO stone over its crown.  The
  // vault came back as a paper-thin shell with a slot along the top.  It is the
  // same law as blocks.js's "an arch block needs material above its crown",
  // restated one scale up, and it costs a whole extra row of tiles.
  build: (m, i, j, k) => vaultSlice(m, { span: 4 * MODULE, height: 3 * MODULE, ix: i, iz: k }),
});

/**
 * THE HALF VAULT.  Two columns of 1x2 - a quadrant springing from a wall and
 * dying at the crown, for where a vault meets a straight face.
 */
mod({
  id: 'half-vault', name: 'Half vault, 24 m', family: 'vault',
  tiles: [2, 1, 3],
  faces: { '+y': 'hall', '-y': 'hall', '+x': 'wall', '-x': 'wall', '+z': 'wall', '-z': 'wall' },
  note: 'The left half of a 48 m arc: two columns of 1x2. It springs at one side and reaches the crown at the other, so it lands flush against a wall or against its own mirror.',
  build: (m, i, j, k) => vaultSlice(m, { span: 4 * MODULE, height: 2 * MODULE, ix: i, iz: k }),
});

/**
 * THE GREAT ARCH.  The same section one cube deep instead of a whole tunnel -
 * a wall with a forty-eight-metre hole in it.
 */
mod({
  id: 'great-arch', name: 'Great arch, 48 m', family: 'vault',
  tiles: [4, 1, 3],
  faces: { '+y': 'wall', '-y': 'wall', '+x': 'wall', '-x': 'wall', '+z': 'wall', '-z': 'wall' },
  note: 'The great vault cut to two cells deep: a wall with an arch through it rather than a tunnel. Same generator, different depth - which is the second law of blocks.js restated one scale up.',
  build: (m, i, j, k) => vaultSlice(m, { span: 4 * MODULE, height: 2 * MODULE, depth: 2, ix: i, iz: k, mat: 'rustic' }),
});

mod({
  id: 'pier-great', name: 'Great pier', family: 'vault',
  faces: { '+y': 'wall', '-y': 'wall', '+x': 'wall', '-x': 'wall', '+z': 'wall', '-z': 'wall' },
  note: 'What a great vault stands on. Rusticated to the springing with a heavy impost course, and deliberately one cube square so the sheet of vault tiles lands on a row of these.',
  build: (m) => {
    for (let x = 0; x < MODULE; x++) for (let y = 0; y < MODULE; y++) {
      for (let z = 0; z < MODULE - 1; z++) put(m, x, y, z, 'pier');
      put(m, x, y, MODULE - 1, 'cornice');
    }
    return m;
  },
});

/* ============================================================ construction */

/**
 * Build the module catalogue.  Entries are catalogue-SHAPED - `{id, size,
 * mesh, layer}` in cells - because `World`, `Engraver`, picking and the saves
 * were all written against "a thing with a size and a mesh", and a cube is a
 * thing with a size and a mesh.  Nothing downstream needed changing.
 *
 * A compound with `tiles` expands into one entry per tile, id `base:i,j,k`,
 * plus a `compound` record so the game can stamp the whole sheet at once.
 */
export function buildModules() {
  const cat = new Map();
  cat.compounds = new Map();
  for (const d of defs) {
    if (d.tiles) {
      const [tw, td, th] = d.tiles;
      const parts = [];
      for (let k = 0; k < th; k++) for (let j = 0; j < td; j++) for (let i = 0; i < tw; i++) {
        const m = new Mesh();
        d.build(m, i, j, k);
        m.finish();
        const id = `${d.id}:${i},${j},${k}`;
        cat.set(id, {
          id, name: `${d.name} [${i},${k}]`, family: d.family, note: d.note,
          size: [MODULE, MODULE, MODULE], rot: true, layer: 'structure',
          faces: d.faces, mesh: m, tileOf: d.id, tile: [i, j, k],
        });
        parts.push({ id, at: [i * MODULE, j * MODULE, k * MODULE] });
      }
      cat.compounds.set(d.id, { id: d.id, name: d.name, family: d.family, note: d.note, tiles: d.tiles, parts });
    } else {
      const m = new Mesh();
      d.build(m);
      m.finish();
      cat.set(d.id, {
        id: d.id, name: d.name, family: d.family, note: d.note,
        size: [MODULE, MODULE, MODULE], rot: true, layer: 'structure',
        faces: d.faces, mesh: m,
      });
      cat.compounds.set(d.id, { id: d.id, name: d.name, family: d.family, note: d.note, tiles: [1, 1, 1], parts: [{ id: d.id, at: [0, 0, 0] }] });
    }
  }
  cat.families = [...new Set(defs.map((d) => d.family))];
  return cat;
}

/** Stamp a whole compound onto a world, at CUBE coordinates. */
export function stampCompound(world, cat, cx, cy, cz, compoundId, rot = 0) {
  const c = cat.compounds.get(compoundId);
  if (!c) throw new Error(`no such module: ${compoundId}`);
  const [tw, td] = c.tiles;
  const spanX = tw * MODULE, spanY = td * MODULE;
  const turn = turnY(rot, spanX, spanY);
  const placed = [];
  for (const p of c.parts) {
    // Turn the tile's own origin with the compound, then take the min corner:
    // a quarter turn maps the box [at, at+MODULE] to another axis-aligned box,
    // and the anchor is that box's low corner.
    const a = turn([p.at[0], p.at[1], p.at[2]]);
    const b = turn([p.at[0] + MODULE, p.at[1] + MODULE, p.at[2]]);
    const x = cx * MODULE + Math.round(Math.min(a[0], b[0]));
    const y = cy * MODULE + Math.round(Math.min(a[1], b[1]));
    const z = cz * MODULE + p.at[2];
    world.place(x, y, z, p.id, rot);
    placed.push([x, y, z, p.id, rot]);
  }
  return placed;
}

export { blocks as blockCatalog };
