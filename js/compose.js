// compose.js - assembling a main block out of sub-blocks.
//
// This is the heart of the game and the reason the catalogue is not
// hand-drawn.  A Piranesi block is not a wall segment: it is over the top,
// imposing, and not remotely practical, and one cube may carry a tower AND a
// staircase AND an archway that do not agree with each other.  You cannot
// hand-author enough of those to keep a builder interesting.  You can compose
// them from a dozen parts, forever.
//
// THE ONE RULE THAT MAKES IT WORK IS THE SOCKET LADDER.
//
// If blocks are generated freely they never line up, and a builder whose pieces
// do not meet is a bag of clutter.  So every block agrees on where things may
// cross its boundary: FOUR DECK LEVELS at fixed heights, and that is all.  A
// stair leaving the +x face at level 2 meets whatever the neighbour put at
// level 2, because there is nowhere else for either of them to be.  Everything
// else about a block is free — its mass, its towers, its arches, where its
// stairs run and whether they make any sense.  Constrain the joins absolutely
// and let the middle be as mad as it likes.
//
// It also gives the thing Escher needs: two blocks side by side each with a
// stair at level 2 make a continuous run, and neither of them knew about the
// other, and nothing checked whether the result could stand up.

import { Mesh } from './mesh.js';
import * as P from './parts.js';

/** Sub-cells along one edge of a main block. */
export const SUB = 8;
/** Metres per sub-cell.  A man is 1.75 m, so he is a little over one. */
export const METRES_PER_SUB = 1.5;
export const BLOCK_METRES = SUB * METRES_PER_SUB;

/**
 * THE DECK LADDER.  The only heights at which anything may cross a block
 * boundary.  Four of them: the floor, and three above.  Sub-cell z.
 */
export const DECKS = [0, 2, 4, 6];

/* ------------------------------------------------------------------ random */

/** A seeded generator.  No Math.random anywhere: a block with a given seed is
 *  the same block forever, in the browser and in the instruments, which is what
 *  lets a saved building reload as the building that was saved. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
const chance = (r, p) => r() < p;
const between = (r, a, b) => a + r() * (b - a);
const irange = (r, a, b) => a + Math.floor(r() * (b - a + 1));

/* ------------------------------------------------------------- archetypes */
/* The SPINE of a block: the one big architectural gesture it is built around.
 * Each returns the deck levels it left available to hang things off. */

const ARCHETYPES = {
  /** A mass of masonry with a great arch cut through it. */
  gate(m, r, S) {
    const axis = chance(r, 0.5) ? 'y' : 'x';
    const thick = between(r, 0.55, 0.95);
    const [a0, a1] = [S * (0.5 - thick / 2), S * (0.5 + thick / 2)];
    const top = pick(r, [5, 6, 7, 8]);
    if (axis === 'y') {
      P.archway(m, { x0: 0, x1: S, y0: a0, y1: a1, z0: 0, z1: top, axis: 'y' });
    } else {
      P.archway(m, { x0: a0, x1: a1, y0: 0, y1: S, z0: 0, z1: top, axis: 'x' });
    }
    return { decks: [0, top >= 6 ? 6 : 4], solidTop: top >= 7, axis };
  },

  /** A pier: the imposing vertical mass. Piranesi's plates are held up by
   *  these and they are almost always the darkest thing present. */
  pier(m, r, S) {
    const inset = between(r, 0.6, 2.0);
    const top = pick(r, [6, 7, 8, 8]);
    P.pier(m, { x0: inset, y0: inset, z0: 0, x1: S - inset, y1: S - inset, z1: top, cornice: true });
    if (chance(r, 0.5)) {
      const z = pick(r, [2, 4]);
      P.pier(m, { x0: inset - 0.5, y0: inset - 0.5, z0: z - 0.3, x1: S - inset + 0.5, y1: S - inset + 0.5, z1: z + 0.2, mat: 'stone' });
    }
    return { decks: [top <= 6 ? top : 6], solidTop: top >= 8, mass: [inset, S - inset] };
  },

  /** A barrel vault overhead, open beneath: the ceiling of the hall. */
  vault(m, r, S) {
    const spring = pick(r, [4, 5]);
    const axis = chance(r, 0.5) ? 'y' : 'x';
    P.archway(m, { x0: 0, x1: S, y0: 0, y1: S, z0: spring, z1: S, axis });
    const legs = between(r, 0.8, 1.6);
    for (const [cx, cy] of [[legs, legs], [S - legs, legs], [legs, S - legs], [S - legs, S - legs]]) {
      if (chance(r, 0.75)) P.pier(m, { x0: cx - legs, y0: cy - legs, z0: 0, x1: cx + legs, y1: cy + legs, z1: spring, cornice: true });
    }
    return { decks: [0, 2], solidTop: true, axis };
  },

  /** A round tower rising through the block. */
  tower(m, r, S) {
    const R = between(r, 2.0, 3.2);
    const top = pick(r, [6, 7, 8]);
    P.drum(m, { cx: S / 2, cy: S / 2, r: R, z0: 0, z1: top, capTop: top < 8 });
    if (chance(r, 0.6)) P.turret(m, { cx: S / 2, cy: S / 2, r: R * 0.55, z0: top, h: between(r, 1.2, 2.4) });
    // A gallery corbelled round it, which is the Plate III move.
    if (chance(r, 0.7)) {
      const gz = pick(r, [2, 4]);
      P.drum(m, { cx: S / 2, cy: S / 2, r: R + 0.75, z0: gz, z1: gz + 0.35, seg: 20, mat: 'stone' });
    }
    return { decks: [0, 2, 4], round: R, solidTop: false };
  },

  /** A well: a shaft straight down through the block. */
  well(m, r, S) {
    const hole = between(r, 2.2, 3.4);
    const [h0, h1] = [(S - hole) / 2, (S + hole) / 2];
    const z = pick(r, [4, 6]);
    // A floor with a square hole in it, made of four slabs.
    P.slab(m, { x0: 0, y0: 0, x1: S, y1: h0, z, t: 0.5 });
    P.slab(m, { x0: 0, y0: h1, x1: S, y1: S, z, t: 0.5 });
    P.slab(m, { x0: 0, y0: h0, x1: h0, y1: h1, z, t: 0.5 });
    P.slab(m, { x0: h1, y0: h0, x1: S, y1: h1, z, t: 0.5 });
    for (const [x0, y0, x1, y1] of [[h0, h0 - 0.4, h1, h0], [h0, h1, h1, h1 + 0.4], [h0 - 0.4, h0, h0, h1], [h1, h0, h1 + 0.4, h1]]) {
      P.balustrade(m, { x0, y0, x1, y1, z: z + 0.5 });
    }
    P.chain(m, { cx: h0 + 0.4, cy: h0 + 0.4, z0: z + 3, z1: z - 2, sag: 0.2 });
    return { decks: [z >= 6 ? 6 : 4], shaft: [h0, h1], solidTop: false };
  },

  /** Nothing but a bridge: a span with a void beneath it. */
  span(m, r, S) {
    const z = pick(r, [2, 4]);
    const axis = chance(r, 0.5) ? 'y' : 'x';
    const w = between(r, 1.6, 2.8);
    const [c0, c1] = [S / 2 - w / 2, S / 2 + w / 2];
    if (axis === 'y') {
      P.slab(m, { x0: c0, y0: 0, x1: c1, y1: S, z, t: 0.4 });
      P.balustrade(m, { x0: c0 - 0.3, y0: 0, x1: c0, y1: S, z: z + 0.4 });
      P.balustrade(m, { x0: c1, y0: 0, x1: c1 + 0.3, y1: S, z: z + 0.4 });
    } else {
      P.slab(m, { x0: 0, y0: c0, x1: S, y1: c1, z, t: 0.4 });
      P.balustrade(m, { x0: 0, y0: c0 - 0.3, x1: S, y1: c0, z: z + 0.4 });
      P.balustrade(m, { x0: 0, y0: c1, x1: S, y1: c1 + 0.3, z: z + 0.4 });
    }
    // Something holding it up, at an angle, not quite enough of it.
    if (chance(r, 0.7)) P.beam(m, { x0: S * 0.2, y0: S * 0.2, z0: 0, x1: S / 2, y1: S / 2, z1: z, r: 0.22 });
    return { decks: [z], solidTop: false, axis };
  },
};

const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

/* ------------------------------------------------------------ attachments */
/* Hung off the spine.  None of them checks whether it could stand up. */

function addStair(m, r, S, decks) {
  if (decks.length < 1) return null;
  const from = pick(r, decks);
  const to = Math.min(6, from + pick(r, [2, 2, 4]));
  if (to <= from) return null;
  const dir = pick(r, ['+x', '-x', '+y', '-y']);
  const w = between(r, 1.1, 1.9);
  const off = between(r, 0.2, S - w - 0.2);
  const run = between(r, S * 0.55, S);
  const box = dir[1] === 'y'
    ? { x0: off, x1: off + w, y0: dir[0] === '+' ? S - run : 0, y1: dir[0] === '+' ? S : run }
    : { x0: dir[0] === '+' ? S - run : 0, x1: dir[0] === '+' ? S : run, y0: off, y1: off + w };
  P.stair(m, { ...box, z0: from, z1: to, dir });
  // A rail on one side, sometimes. Piranesi leaves plenty without.
  return { from, to, dir };
}

function addDeck(m, r, S, decks) {
  const z = pick(r, DECKS);
  const w = between(r, 2, S * 0.7), d = between(r, 2, S * 0.7);
  const x0 = between(r, -0.5, S - w), y0 = between(r, -0.5, S - d);
  P.slab(m, { x0, y0, x1: x0 + w, y1: y0 + d, z, t: 0.36 });
  if (chance(r, 0.7)) P.balustrade(m, { x0, y0: y0 - 0.28, x1: x0 + w, y1: y0, z: z + 0.36 });
  if (chance(r, 0.45)) P.corbel(m, { cx: x0 + w / 2, cy: y0, z: z - 0.7, out: 0.7 });
  decks.push(z);
  return z;
}

function addCatwalk(m, r, S) {
  const z = pick(r, DECKS.slice(1));
  const w = between(r, 1.0, 1.6);
  if (chance(r, 0.5)) {
    const y = between(r, 0.5, S - w - 0.5);
    P.catwalk(m, { x0: -0.3, x1: S + 0.3, y0: y, y1: y + w, z });
  } else {
    const x = between(r, 0.5, S - w - 0.5);
    P.catwalk(m, { x0: x, x1: x + w, y0: -0.3, y1: S + 0.3, z });
  }
  return z;
}

function addIron(m, r, S) {
  const n = irange(r, 1, 3);
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.4) P.chain(m, { cx: between(r, 1, S - 1), cy: between(r, 1, S - 1), z0: between(r, 5, 8), z1: between(r, 1, 4), sag: between(r, 0, 0.35) });
    else if (k < 0.7) P.ring(m, { cx: between(r, 1.5, S - 1.5), cy: between(r, 0.2, 0.6), z: between(r, 2, 6), r: between(r, 0.18, 0.3) });
    else P.lamp(m, { cx: between(r, 2, S - 2), cy: between(r, 2, S - 2), z: between(r, 5.5, 7.8), drop: between(r, 0.6, 2.2) });
  }
}

function addTimber(m, r, S) {
  const k = r();
  if (k < 0.45) {
    P.gantry(m, { cx: between(r, 1.5, S - 1.5), cy: between(r, 1.5, S - 1.5), z0: 0, z1: between(r, 4, 7.5) });
  } else if (k < 0.8) {
    // A raking shore: the diagonal a lattice cannot give you.
    P.beam(m, {
      x0: between(r, 0, 2), y0: between(r, 0, 2), z0: 0,
      x1: between(r, S - 3, S), y1: between(r, S - 3, S), z1: between(r, 4, 7.5), r: between(r, 0.18, 0.32),
    });
  } else {
    const z = between(r, 5, 7.5);
    P.beam(m, { x0: -0.4, y0: between(r, 1, S - 1), z0: z, x1: S + 0.4, y1: between(r, 1, S - 1), z1: z, r: 0.26 });
  }
}

/* ============================================================ the composer */

/**
 * Build one main block.
 *
 * @param seed  any integer; the same seed always gives the same block
 * @returns {mesh, sockets, recipe}
 */
export function composeBlock(seed) {
  const r = rng(seed * 2654435761 + 12345);
  const m = new Mesh();
  const S = SUB;

  const archId = ARCHETYPE_IDS[Math.floor(r() * ARCHETYPE_IDS.length)];
  const spine = ARCHETYPES[archId](m, r, S) || { decks: [0] };
  const decks = [...new Set(spine.decks || [0])];
  const recipe = [archId];

  // THREE TO FIVE ATTACHMENTS. Fewer and the block is a component; more and it
  // is soup. Piranesi's own density is roughly "one more thing than the space
  // can take", which is what the upper end of this range produces.
  const n = irange(r, 3, 5);
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.32) { const s = addStair(m, r, S, decks); if (s) recipe.push(`stair ${s.dir} ${s.from}->${s.to}`); }
    else if (k < 0.55) recipe.push(`deck @${addDeck(m, r, S, decks)}`);
    else if (k < 0.72) recipe.push(`catwalk @${addCatwalk(m, r, S)}`);
    else if (k < 0.88) { addTimber(m, r, S); recipe.push('timber'); }
    else { addIron(m, r, S); recipe.push('iron'); }
  }
  // Every block gets a little ironmongery: it is what makes the architecture
  // read as a prison rather than as a monument.
  if (!recipe.includes('iron')) { addIron(m, r, S); recipe.push('iron'); }

  m.finish();
  tagBoundaryFaces(m, S);

  return {
    seed, mesh: m, recipe,
    archetype: archId,
    sockets: socketsOf(decks, spine, S),
  };
}

/**
 * Faces lying exactly on the cube's boundary get a `side` tag, so that two
 * neighbouring blocks cancel them and the join disappears.
 *
 * Done as a POST-PASS over the finished mesh rather than threaded through every
 * part, because a part has no idea where it was placed — `pier` does not know
 * whether it happens to have landed against the edge of the block.  Asking the
 * geometry afterwards is both simpler and impossible to forget.
 */
function tagBoundaryFaces(mesh, S) {
  const EPS = 1e-6;
  const planes = [
    ['+x', 0, S], ['-x', 0, 0], ['+y', 1, S], ['-y', 1, 0], ['+z', 2, S], ['-z', 2, 0],
  ];
  for (const f of mesh.faces) {
    for (const [side, axis, at] of planes) {
      let on = true;
      for (const i of f.v) {
        if (Math.abs(mesh.verts[i][axis] - at) > EPS) { on = false; break; }
      }
      if (on) { f.side = side; break; }
    }
  }
}

/** What this block offers its neighbours, per face, per deck level. */
function socketsOf(decks, spine, S) {
  const out = {};
  for (const side of ['+x', '-x', '+y', '-y']) {
    out[side] = DECKS.map((d) => (decks.includes(d) ? 'deck' : 'none'));
  }
  out['+z'] = spine.solidTop ? 'solid' : 'open';
  out['-z'] = 'open';
  void S;
  return out;
}

/* -------------------------------------------------------------- catalogue */

/**
 * A hand of blocks for the player to build with.
 *
 * DELIBERATELY A FIXED SET, not "generate a new one every time you place".  A
 * builder needs a vocabulary you can learn — you want to reach for THAT block,
 * the one with the stair going the wrong way.  Endless novelty is the same as
 * no vocabulary at all.  Reroll is a button, not a policy.
 */
export function buildCatalog(count = 24, seed0 = 1) {
  const cat = new Map();
  for (let i = 0; i < count; i++) {
    const b = composeBlock(seed0 + i * 7919);
    const id = `b${i}`;
    cat.set(id, {
      id, name: `${b.archetype} ${String(b.seed).slice(-4)}`,
      family: b.archetype,
      size: [SUB, SUB, SUB],
      rot: true, layer: 'structure',
      mesh: b.mesh, sockets: b.sockets, recipe: b.recipe, seed: b.seed,
      note: b.recipe.join(' + '),
    });
  }
  cat.families = [...new Set([...cat.values()].map((d) => d.family))];
  return cat;
}
