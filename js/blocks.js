// blocks.js - the architectural catalogue.
//
// THE MODULE.  One cell is 2.0 metres.  That number is not arbitrary and every
// proportion below hangs off it:
//
//   * a man is 1.75 m, so he stands 0.87 of a cell - just under head height in
//     a doorway one cell tall, which is how a doorway should feel;
//   * a two-cell arch spans 4 m and a four-cell arch spans 8 m, which are the
//     spans of the Roman work Piranesi measured and drew all his life;
//   * and, the reason it is 2 and not 1.5 or 3:
//
//       A SEMICIRCULAR ARCH OF SPAN S RISES S/2.
//
//     So an arch spanning an EVEN number of cells crowns exactly on a cell
//     boundary, and everything a player stacks on top of it lands on the grid.
//     An odd span crowns half a cell up and every course above it is off-lattice
//     forever.  This is the joinery law the whole catalogue obeys: arches come
//     in even spans, and their rise is half their span.  Get this wrong and the
//     building never closes.
//
// THE SECOND LAW is that an arch and a barrel vault are THE SAME OBJECT at
// different depths.  A Roman arch is a vault one stone thick; a vault is an arch
// extruded until you can walk through it.  So there is one builder, `voidedBay`,
// and the catalogue asks it for depth 0.3 to get an arcade and depth 1.0 to get
// a tunnel.  That is not a code-sharing convenience, it is what the buildings
// are, and it means the intrados of an arch and the soffit of a vault are
// hatched by the same rule and read as the same material.
//
// THE TIERS.  A block is `structure` (default) or `fitting`; see world.js.  A
// handrail, a ring, a lamp and a balustrade are fittings, because they sit ON
// something rather than instead of it.

import { Mesh, box, sweep, arc, lathe, strut, turnY, translate } from './mesh.js';

/** Metres per cell.  Referenced by the scale figure and by the HUD. */
export const METRES_PER_CELL = 2.0;
/** How tall a man is, in cells.  The staffage will use this; the catalogue uses
 *  it to size handrails and treads to a body rather than to the grid. */
export const MAN = 1.75 / METRES_PER_CELL;

/** Arc tessellation.  16 steps over a semicircle is 11.25 degrees per facet,
 *  which sits comfortably under mesh.js's 26-degree crease threshold, so the
 *  facets never become drawn lines and the arch reads as a curve. */
const ARCSEG = 16;

/* ============================================================== primitives */

/**
 * A bay with a semicircular void through it - the single most important shape
 * in the game.  Returns the material of a rectangular block `span x depth x
 * height` minus a half-cylinder of radius `span/2` whose axis runs along +y at
 * the springing.
 *
 * The cross-section is a rectangle with a bite out of the bottom, which is not
 * convex, so it is decomposed into VERTICAL STRIPS: over each step of the arc,
 * the material runs from the arc up to the top of the block.  Every strip is a
 * convex quad, the strips tile the section exactly, and at the springing the end
 * strips degenerate to full-height rectangles all on their own.  (The obvious
 * alternative - radial wedges about the arch centre - leaves the corners of the
 * block uncovered and needs a special case for each one.)
 *
 * @param depth  0.3 -> an arch in a wall.  1.0 -> one bay of a barrel vault.
 */
export function voidedBay(m, { span, height, depth, y0 = 0, mat = 'stone', soffit = 'plaster' }) {
  const r = span / 2;
  const y1 = y0 + depth;
  const pts = arc(r, 0, r, Math.PI, 0, ARCSEG);      // (x,z) left springing -> right

  // --- the two faces of the wall, strip by strip ---------------------------
  // These lie on cell boundaries when depth is 1, which is what lets a run of
  // vault bays cancel its internal membranes and become a tunnel.
  for (const [y, flip] of [[y0, true], [y1, false]]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [xa, za] = pts[i], [xb, zb] = pts[i + 1];
      if (za >= height - 1e-6 && zb >= height - 1e-6) continue;   // no material left
      const q = [
        m.vert([xa, y, za]), m.vert([xb, y, zb]),
        m.vert([xb, y, height]), m.vert([xa, y, height]),
      ];
      m.face(flip ? q : q.slice().reverse(), {
        mat,
        u: [1, 0, 0], vDir: [0, 0, 1],
        // A spandrel is hatched with its own height, like the pier it continues.
        hatch: 'v',
        side: flip ? '-y' : '+y',
        tag: 'spandrel',
      });
    }
  }

  // --- the intrados: the swept underside of the arch ------------------------
  // u runs along the sweep (through the arch), v runs round the curve.  The
  // default hatch is 'v', so the strokes WRAP THE BARREL - which is exactly what
  // Piranesi draws on every vault in the Carceri, and it comes out of the
  // surface's own parameterisation rather than out of a special case.
  for (let i = 0; i < pts.length - 1; i++) {
    const [xa, za] = pts[i], [xb, zb] = pts[i + 1];
    const dx = xb - xa, dz = zb - za;
    const L = Math.hypot(dx, dz) || 1;
    m.face([
      m.vert([xa, y0, za]), m.vert([xa, y1, za]),
      m.vert([xb, y1, zb]), m.vert([xb, y0, zb]),
    ], {
      mat: soffit,
      u: [0, 1, 0], vDir: [dx / L, 0, dz / L],
      hatch: 'v',
      tag: 'intrados',
      // The one surface in the catalogue that MUST keep its own frame: the
      // strokes wrap the barrel, which is unmistakable in every plate.
      form: true,
    });
  }

  // --- the outside of the block --------------------------------------------
  box(m, [0, y0, 0], [span, y1, height], {
    mat,
    skip: ['-y', '+y', '-z'],   // -y/+y are the strip faces above; -z is a line
  });
  return m;
}

/** Drafted-margin rustication is drawn, not modelled - see engrave.js `course`.
 *  What IS modelled is the impost: the projecting band a pier hands its arch. */
function impost(m, x0, x1, y0, y1, z, mat = 'stone') {
  box(m, [x0 - 0.06, y0 - 0.06, z - 0.12], [x1 + 0.06, y1 + 0.06, z], { mat, tag: 'impost' });
}

/* ================================================================ catalogue */

const defs = [];
/** @param o {id,name,family,size,build,rot,layer,note} */
const def = (o) => { defs.push(o); return o; };

/* ---- solids: the mass everything else is cut out of ---------------------- */

def({
  id: 'pier', name: 'Rusticated pier', family: 'mass', size: [1, 1, 1], rot: false,
  note: 'The atom. Fills its cell exactly, so a stack of them cancels every internal face and reads as one shaft of stone.',
  build: (m) => box(m, [0, 0, 0], [1, 1, 1], { mat: 'rustic', tag: 'pier' }),
});

def({
  id: 'ashlar', name: 'Ashlar block', family: 'mass', size: [1, 1, 1], rot: false,
  note: 'The same cell in dressed stone - finer courses, no drafted margin. Use it where a wall wants to be quiet.',
  build: (m) => box(m, [0, 0, 0], [1, 1, 1], { mat: 'stone', tag: 'ashlar' }),
});

def({
  id: 'brick', name: 'Brick-faced mass', family: 'mass', size: [1, 1, 1], rot: false,
  note: 'Roman opus testaceum. The finest coursing in the catalogue; below about five pixels a course the engraver stops drawing it and lets it be tone.',
  build: (m) => box(m, [0, 0, 0], [1, 1, 1], { mat: 'brick', tag: 'brick' }),
});

def({
  id: 'wall', name: 'Wall slab', family: 'mass', size: [1, 1, 1], rot: true,
  note: 'A 0.6 m wall on the cell edge. A row of them along x joins seamlessly; the cell-boundary faces coincide and cancel.',
  build: (m) => box(m, [0, 0, 0], [1, 0.3, 1], { mat: 'stone', tag: 'wall' }),
});

def({
  id: 'paving', name: 'Paved ground', family: 'mass', size: [1, 1, 1], rot: false,
  note: 'A whole cell of made ground. It FILLS the cell on purpose: a thin slab leaves three quarters of a cell of air under everything you stand on it, and a floor you cannot build flush with is not a floor. For a plate hanging in space use a landing.',
  build: (m) => box(m, [0, 0, 0], [1, 1, 1], { mat: 'stone', tag: 'paving', hatchTop: 'u' }),
});

def({
  id: 'cornice', name: 'Cornice course', family: 'mass', size: [1, 1, 1], rot: true,
  note: 'A projecting string course. Piranesi runs one round every pier at every impost level; it is what stops a shaft looking like a chimney.',
  build: (m) => {
    box(m, [0, 0, 0], [1, 1, 0.55], { mat: 'stone', tag: 'core' });
    box(m, [-0.12, -0.12, 0.55], [1.12, 1.12, 0.78], { mat: 'stone', tag: 'corona' });
    box(m, [-0.05, -0.05, 0.78], [1.05, 1.05, 1], { mat: 'stone', tag: 'cyma' });
    return m;
  },
});

/* ---- the void: arches and vaults ---------------------------------------- */

def({
  id: 'arch-2', name: 'Arch, 4 m span', family: 'void', size: [2, 1, 2], rot: true,
  note: 'Span 2 cells, rise 1, one cell of spandrel above - an arcade bay. Crowns on the lattice, so you can build straight on top of it.',
  build: (m) => { voidedBay(m, { span: 2, height: 2, depth: 0.3, y0: 0.35 }); impost(m, 0, 2, 0.35, 0.65, 0.02); return m; },
});

def({
  id: 'arch-4', name: 'Arch, 8 m span', family: 'void', size: [4, 1, 3], rot: true,
  note: 'The monumental span. Rise 2 cells, one cell above the crown. Two piers three cells apart and this closes the gap.',
  build: (m) => { voidedBay(m, { span: 4, height: 3, depth: 0.3, y0: 0.35 }); impost(m, 0, 4, 0.35, 0.65, 0.02); return m; },
});

def({
  id: 'vault-2', name: 'Barrel vault bay, 4 m', family: 'void', size: [2, 1, 2], rot: true,
  note: 'The same arch a whole cell deep. Lay them in a row and the membranes between bays cancel - that is the tunnel.',
  build: (m) => voidedBay(m, { span: 2, height: 2, depth: 1, y0: 0, soffit: 'plaster' }),
});

def({
  id: 'vault-4', name: 'Barrel vault bay, 8 m', family: 'void', size: [4, 1, 3], rot: true,
  note: 'The great tunnel. One of these overhead and the space stops being a room.',
  build: (m) => voidedBay(m, { span: 4, height: 3, depth: 1, y0: 0, soffit: 'plaster' }),
});

/* ---- circulation --------------------------------------------------------- */

def({
  id: 'stair', name: 'Stair flight', family: 'walk', size: [1, 2, 1], rot: true,
  note: 'Rises one cell over two: eight treads at 25 cm rise, 50 cm going. Monumental, not domestic - and it lands exactly on the next storey.',
  build: (m) => {
    const N = 8, rise = 1 / N, going = 2 / N;
    for (let i = 0; i < N; i++) {
      box(m, [0, i * going, 0], [1, 2, (i + 1) * rise], {
        mat: 'stone', tag: 'tread', skip: i ? ['-y'] : [],
      });
    }
    return m;
  },
});

def({
  id: 'landing', name: 'Landing', family: 'walk', size: [1, 1, 1], rot: false,
  note: 'A plate at the TOP of its cell, so a stair arriving from below meets it dead level. Paving sits at the bottom; a landing hangs at the top.',
  build: (m) => box(m, [0, 0, 0.75], [1, 1, 1], { mat: 'stone', tag: 'landing', hatchTop: 'u' }),
});

def({
  id: 'catwalk', name: 'Plank catwalk', family: 'walk', size: [1, 1, 1], rot: true,
  note: 'Boards on two bearers, hung at walking height. The Carceri are strung with these.',
  build: (m) => {
    for (let i = 0; i < 4; i++) {
      box(m, [0, 0.04 + i * 0.24, 0.86], [1, 0.24 + i * 0.24, 0.94], { mat: 'timber', tag: 'plank', hatchTop: 'u' });
    }
    box(m, [0.02, 0, 0.78], [0.14, 1, 0.86], { mat: 'timber', tag: 'bearer' });
    box(m, [0.86, 0, 0.78], [0.98, 1, 0.86], { mat: 'timber', tag: 'bearer' });
    return m;
  },
});

/* ---- guarding (fittings: they sit ON the thing they guard) --------------- */

def({
  id: 'balustrade', layer: 'fitting', name: 'Balustrade', family: 'guard', size: [1, 1, 1], rot: true,
  note: 'Stone balusters and a coping, on the -y edge. A fitting, so it can stand on paving or a landing without displacing it.',
  build: (m) => {
    box(m, [0, 0.02, 0], [1, 0.26, 0.1], { mat: 'stone', tag: 'plinth' });
    for (let i = 0; i < 4; i++) {
      const cx = 0.125 + i * 0.25;
      lathe(m, cx, 0.14, [[0.055, 0.1], [0.075, 0.16], [0.045, 0.30], [0.085, 0.40], [0.05, 0.52]], 8,
        { mat: 'stone', tag: 'baluster', capTop: false });
    }
    box(m, [0, 0, 0.52], [1, 0.28, 0.62], { mat: 'stone', tag: 'coping' });
    return m;
  },
});

def({
  id: 'railing', layer: 'fitting', name: 'Timber railing', family: 'guard', size: [1, 1, 1], rot: true,
  note: 'The plain handrail that runs beside every stair and gangway in the plates. Cheaper and commoner than the balustrade.',
  build: (m) => {
    box(m, [0.03, 0.09, 0], [0.13, 0.19, 0.62], { mat: 'timber', tag: 'newel' });
    box(m, [0.87, 0.09, 0], [0.97, 0.19, 0.62], { mat: 'timber', tag: 'newel' });
    box(m, [0, 0.10, 0.52], [1, 0.18, 0.60], { mat: 'timber', tag: 'rail' });
    box(m, [0, 0.11, 0.24], [1, 0.17, 0.30], { mat: 'timber', tag: 'rail' });
    return m;
  },
});

def({
  id: 'stair-railing', layer: 'fitting', name: 'Stair railing', family: 'guard', size: [1, 2, 1], rot: true,
  note: 'The same handrail raked to the going of a flight, which is why it is its own block: a level rail beside a stair is the tell that nobody measured anything.',
  build: (m) => {
    const rise = 1, run = 2;
    const railZ = (y) => 0.62 + (y / run) * rise;
    for (let i = 0; i <= 4; i++) {
      const y = 0.12 + i * 0.44;
      box(m, [0.03, y, (y / run) * rise], [0.13, y + 0.10, railZ(y)], { mat: 'timber', tag: 'newel' });
    }
    strut(m, [0.08, 0.05, railZ(0.05)], [0.08, run - 0.05, railZ(run - 0.05)], 0.045, { tag: 'rail' });
    strut(m, [0.08, 0.05, railZ(0.05) - 0.28], [0.08, run - 0.05, railZ(run - 0.05) - 0.28], 0.032, { tag: 'rail' });
    return m;
  },
});

/* ---- timber -------------------------------------------------------------- */

def({
  id: 'beam', name: 'Timber baulk', family: 'timber', size: [3, 1, 1], rot: true,
  note: 'A 6 m baulk crossing the void at the top of its cells. In the plates these cut right across the composition and are half the reason the space is illegible.',
  build: (m) => {
    box(m, [0, 0.34, 0.68], [3, 0.66, 1], { mat: 'timber', tag: 'baulk' });
    box(m, [0.94, 0.30, 0.66], [1.06, 0.70, 1.02], { mat: 'iron', tag: 'strap' });
    box(m, [1.94, 0.30, 0.66], [2.06, 0.70, 1.02], { mat: 'iron', tag: 'strap' });
    return m;
  },
});

def({
  id: 'gantry', name: 'Braced gantry', family: 'timber', size: [1, 1, 2], rot: true,
  note: 'A post with knee braces - the scaffolding that holds up the impossible parts. Stack it to any height.',
  build: (m) => {
    box(m, [0.38, 0.38, 0], [0.62, 0.62, 2], { mat: 'timber', tag: 'post' });
    // Knee braces, off-axis: the one thing a lattice cannot give you for free.
    // (The first version sheared a box through a non-rigid transform and came
    // back as a pair of arrowheads. `strut` builds a frame from the member's
    // own direction, which is both correct geometry and correct grain.)
    for (const s of [-1, 1]) {
      strut(m, [0.5 + s * 0.10, 0.5, 1.42], [0.5 + s * 0.46, 0.5, 1.94], 0.055, { tag: 'brace' });
      strut(m, [0.5, 0.5 + s * 0.10, 1.42], [0.5, 0.5 + s * 0.46, 1.94], 0.055, { tag: 'brace' });
    }
    return m;
  },
});

def({
  id: 'raking-shore', name: 'Raking shore', family: 'timber', size: [2, 1, 2], rot: true,
  note: 'A great diagonal baulk propping a wall, with a cleat and a sole plate. The single most Piranesian object that is not architecture.',
  build: (m) => {
    strut(m, [0.15, 0.5, 0.08], [1.9, 0.5, 1.95], 0.11, { tag: 'rake' });
    box(m, [0, 0.3, 0], [0.7, 0.7, 0.16], { mat: 'timber', tag: 'sole' });
    strut(m, [0.62, 0.5, 0.10], [1.42, 0.5, 1.02], 0.06, { tag: 'cleat' });
    return m;
  },
});

/* ---- iron (fittings) ----------------------------------------------------- */

def({
  id: 'ring', layer: 'fitting', name: 'Iron ring and chain', family: 'iron', size: [1, 1, 1], rot: true,
  note: 'A ring bolted to the wall with a chain hanging from it. The darkest thing in the catalogue; a few of these carry the whole subject of the Carceri.',
  build: (m) => {
    box(m, [0.44, 0.02, 0.74], [0.56, 0.16, 0.86], { mat: 'iron', tag: 'boss' });
    const R = 0.13;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
      const p = (a) => [0.5 + Math.cos(a) * R, 0.16, 0.66 + Math.sin(a) * R];
      const q = (a) => [0.5 + Math.cos(a) * R * 0.72, 0.16, 0.66 + Math.sin(a) * R * 0.72];
      m.face([m.vert(p(a0)), m.vert(p(a1)), m.vert(q(a1)), m.vert(q(a0))],
        { mat: 'iron', u: [1, 0, 0], vDir: [0, 0, 1], hatch: 'u', tag: 'ring' });
    }
    for (let i = 0; i < 5; i++) {
      const z = 0.53 - i * 0.105;
      box(m, [0.47, 0.13, z], [0.53, 0.19, z + 0.08], { mat: 'iron', tag: 'link' });
    }
    return m;
  },
});

def({
  id: 'lamp', layer: 'fitting', name: 'Hanging lamp', family: 'iron', size: [1, 1, 1], rot: false,
  note: 'The lantern on its bracket from Plate VII. It is the only light source the eye can find, which is the point.',
  build: (m) => {
    box(m, [0.48, 0.48, 0.62], [0.52, 0.52, 1], { mat: 'iron', tag: 'stem' });
    lathe(m, 0.5, 0.5, [[0.02, 0.62], [0.16, 0.52], [0.18, 0.34], [0.12, 0.26], [0.03, 0.22]], 8,
      { mat: 'iron', tag: 'lantern', hatch: 'v' });
    return m;
  },
});

/* ---- round work ---------------------------------------------------------- */

def({
  id: 'drum', name: 'Round tower drum', family: 'round', size: [1, 1, 1], rot: false,
  note: 'One course of the round tower of Plate III. Stack them. The flanks are smooth, so their outline is found as a silhouette each frame rather than being a modelled edge.',
  build: (m) => lathe(m, 0.5, 0.5, [[0.5, 0], [0.5, 1]], 24, { mat: 'rustic', tag: 'drum', capTop: false, hatch: 'v' }),
});

def({
  id: 'column', name: 'Column', family: 'round', size: [1, 1, 1], rot: false,
  note: 'A shaft with a plain Tuscan cap and base - entasis included, because a straight cylinder reads as a pipe.',
  build: (m) => {
    box(m, [0.28, 0.28, 0], [0.72, 0.72, 0.07], { mat: 'stone', tag: 'plinth' });
    const prof = [[0.21, 0.07], [0.20, 0.12]];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      prof.push([0.185 - 0.035 * t * t, 0.12 + t * 0.72]);   // entasis: a slight swell
    }
    prof.push([0.20, 0.86], [0.23, 0.90]);
    lathe(m, 0.5, 0.5, prof, 16, { mat: 'stone', tag: 'shaft', capTop: false, hatch: 'v' });
    box(m, [0.25, 0.25, 0.90], [0.75, 0.75, 1], { mat: 'stone', tag: 'abacus' });
    return m;
  },
});

/* ============================================================ construction */

/** Build every mesh once.  Blocks are placed thousands of times and the meshes
 *  never change, so all the per-face plane/frame/edge work happens here. */
export function buildCatalog() {
  const cat = new Map();
  for (const d of defs) {
    const m = new Mesh();
    d.build(m);
    m.finish();
    cat.set(d.id, {
      id: d.id, name: d.name, family: d.family,
      size: d.size, rot: d.rot !== false, note: d.note || '',
      layer: d.layer || 'structure',
      mesh: m,
    });
  }
  cat.families = [...new Set(defs.map((d) => d.family))];
  return cat;
}

export { defs as blockDefs, turnY, translate };
