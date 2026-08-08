// stack.js — THE COMPOSER.  A block is a stack of plans.
//
// The owner's second drawing: one block as three coloured slabs on the thirds,
// each with its own plan cut on the slice lines, and an arch struck across the
// top.  "i tried to imagine an example of how the slice lines can be used in
// unusual combinations to make a wide variety of shapes and structures.
// vertically i stuck to just the basic 1/3rd slices for this one block."
//
// This replaces the archetype-plus-attachments composer, and it is better in
// the way that matters: THE OLD ONE COULD PRODUCE AN ILLEGAL BLOCK AND THIS ONE
// CANNOT.  Every plan's every vertex is on a slice plane or on one of the two
// radii, so a generated block cannot drift off the grid and quietly stop
// meeting its neighbours — which is exactly what the old one did, silently, for
// its whole life: zero faces cancelled between any two composed blocks, ever.
//
// TWO FAMILIES, because a vertical prism cannot express a vault.
//
//   STACK  three plans, one per third of the block's height.  His drawing.
//   ARCH   a plan extruded up to the SPRINGING at 4.5, and the whole-block
//          circle's spandrels above it.  Piers with a vault on them, which is
//          the single most Piranesian object there is, and the reason R_WHOLE
//          exists.
//
// The arch family is not a special case bolted on: 4.5 is a slice plane and
// R_WHOLE is exactly half the block, so the springing lands on the grid and the
// crown lands on the boundary.  The two families meet each other correctly
// without either knowing about the other.

import { Mesh, sweep } from './mesh.js';
import { SUB, R_WHOLE, DECKS, PRIMARY } from './cube.js';
import { PLANS, PLAN_IDS, turnPlan, extrudePlan } from './plan.js';
import { drawnMesh } from './drawn.js';
import { stackRecipe, archRecipe, decode, seedOf, label, LAYERS } from './recipe.js';
import { vault, halfVault, tagFlat } from './forms.js';
import { insideMesh } from './solidity.js';
import { arc } from './mesh.js';

const S = SUB;
const C = S / 2;
export { LAYERS };
/** The horizontal cuts a stacked block uses: his "basic 1/3rd slices".  Defined
 *  in cube.js, where the drawing board and the ramp can reach it too — it is a
 *  fact about the cube, not about this composer. */
export { DECKS };

/* ------------------------------------------------------------------ random */

/** Seeded, deterministic, and there is no Math.random anywhere in this project:
 *  a block with a given seed must be the same block in the browser, in the
 *  instruments and in a save file reloaded a year later. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const pick = (r, a) => a[Math.min(a.length - 1, Math.floor(r() * a.length))];
const irange = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const chance = (r, p) => r() < p;

/* ---------------------------------------------------------------- building */

/** A stacked block: one plan per third.  `extrudePlan` lives in plan.js so that
 *  the drawing board raises stone by exactly the same act — see drawn.js. */
function stackMesh(layers, mat) {
  const m = new Mesh();
  layers.forEach((L, i) => {
    const polys = turnPlan(PLANS[L.id].make(), L.q);
    extrudePlan(m, polys, DECKS[i], DECKS[i + 1], mat, `layer${i}:${L.id}`);
  });
  tagFlat(m);
  return m;
}

/** An arch block: piers to the springing, the whole-block vault above. */
function archMesh(pier, axis, hand, mat) {
  const m = new Mesh();
  extrudePlan(m, turnPlan(PLANS[pier.id].make(), pier.q), 0, C, mat, `pier:${pier.id}`);
  // The spandrels, lifted into place.  vault() builds them in its own block, so
  // merge rather than re-derive — one arc, one definition, no chance of the two
  // drifting apart.
  const v = hand === 'both' ? vault(axis) : halfVault(axis, hand);
  m.merge(v, (p) => p);
  tagFlat(m);
  return m;
}

/* ------------------------------------------------------------- the anchors */

/**
 * WHERE A SECONDARY THING MAY BE BOLTED ON.
 *
 * The owner: "anchor points are special features that are defined by what is
 * near them… but if you do have viable anchor points they should connect to
 * other anchor points on other blocks."  And on what they are: "start them off
 * as a red cube that can be clicked on to select, none, torch, ring."
 *
 * So a site is a PLACE, declared by the block; its KIND is the player's, chosen
 * later.  A block never decides it has a torch — it decides it has somewhere a
 * torch could go.
 *
 * Sites sit on the vertical faces only, on the sub-block grid, and they are
 * SECONDARY: exempt from the slice planes by his own rule, because a bracket
 * that had to land on a slice plane would be a worse bracket.  What keeps them
 * orderly instead is that they hang off the deck heights — you do not put a
 * torch at knee height or above the reach of a ladder.
 */
/** Chest height on each of the three storeys, in yards.  Deliberately NOT on a
 *  slice plane: anchors are SECONDARY and exempt by his own rule, and a bracket
 *  that had to land on a slice plane would be a worse bracket. */
const ANCHOR_Z = [1.6, 4.6, 7.6];
const SIDES = ['+x', '-x', '+y', '-y'];

/**
 * FILTER FIRST, THEN CHOOSE.  Drawing candidates at random and then rejecting
 * the ones with nothing behind them means a block that is mostly void gets
 * nothing, however many places it has that would work — the first version dealt
 * five sites across sixteen blocks that way.  Enumerating the whole grid,
 * keeping the backed ones, and taking from those gives every block its share.
 */
function anchorsFor(r, mesh) {
  if (!chance(r, 0.75)) return [];               // not every block offers one
  const viable = [];
  for (const side of SIDES) {
    for (const u of [2, 4.5, 7]) {               // his green lines, across the face
      for (const z of ANCHOR_Z) {
        const a = { side, u, z, kind: null };
        if (backed(mesh, a)) viable.push(a);
      }
    }
  }
  if (!viable.length) return [];
  // Deterministic shuffle, then take.  A block keeps the same sites forever.
  for (let i = viable.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [viable[i], viable[j]] = [viable[j], viable[i]];
  }
  return viable.slice(0, irange(r, 1, 3));
}

/**
 * Is there material immediately inside this face at this point?
 *
 * A REAL POINT-IN-MESH TEST, not a proximity-to-vertex one.  The first version
 * asked whether any vertex was within three quarters of a yard, which is true
 * at the corners of a wall and false everywhere along it — so a site in the
 * middle of a perfectly solid face was rejected, and two blocks in fourteen
 * shipped an anchor.  A big flat face has four vertices and a lot of middle.
 */
function backed(mesh, a) {
  const IN = 0.4;
  const p = pointOf(a);
  const n = normalOf(a.side);
  return insideMesh(mesh, p[0] - n[0] * IN, p[1] - n[1] * IN, p[2]);
}

export function normalOf(side) {
  return side === '+x' ? [1, 0, 0] : side === '-x' ? [-1, 0, 0]
    : side === '+y' ? [0, 1, 0] : [0, -1, 0];
}

/** The site's point in block-local coordinates. */
export function pointOf(a) {
  switch (a.side) {
    case '+x': return [S, a.u, a.z];
    case '-x': return [0, a.u, a.z];
    case '+y': return [a.u, S, a.z];
    default: return [a.u, 0, a.z];
  }
}

/* ------------------------------------------------------------- the recipe */

/**
 * ROLL a recipe.  This is the only place chance enters, and what it produces is
 * a STRING — not a block.  Everything downstream builds from that string, so a
 * block is always the block its recipe says it is, and the generator can change
 * underneath a saved building without changing it.
 */
export function rollRecipe(seed) {
  const r = rng(seed);
  const mat = chance(r, 0.12) ? 'rustic' : 'stone';

  if (chance(r, 0.34)) {
    // ARCH.  The pier plan comes from the ones that leave a way through: a
    // vault standing on a solid block is a lid, not an arch.
    const id = pick(r, ['twin', 'bar', 'bar-wide', 'corner', 'quarters', 'ell', 'tee']);
    const pier = { id, q: irange(r, 0, PLANS[id].turns - 1) };
    const axis = chance(r, 0.5) ? 'x' : 'y';
    const hand = chance(r, 0.72) ? 'both' : (chance(r, 0.5) ? 'left' : 'right');
    return archRecipe(axis, hand, pier, mat);
  }

  // STACK.  Sorted heaviest-first most of the time, because a block that is
  // solid on top and hollow underneath reads as a mistake rather than as an
  // impossibility — and the impossibilities should be the player's, not the
  // generator's.
  const layers = [];
  for (let i = 0; i < LAYERS; i++) {
    const id = pick(r, PLAN_IDS);
    layers.push({ id, q: irange(r, 0, PLANS[id].turns - 1) });
  }
  if (chance(r, 0.7)) layers.sort((a, b) => PLANS[b.id].mass - PLANS[a.id].mass);
  return stackRecipe(layers, mat);
}

/**
 * BUILD a block from its recipe.  Total: the same string always gives the same
 * block, in the browser, in the instruments, and in a save file reopened after
 * the vocabulary has grown around it.
 *
 * @returns a catalogue entry, or null if this version cannot build that recipe.
 */
export function blockFromRecipe(recipe) {
  const d = decode(recipe);
  if (!d.ok) return null;
  const mesh = d.family === 'arch' ? archMesh(d.pier, d.axis, d.hand, d.mat)
    : d.family === 'drawn' ? drawnMesh(d)
      : stackMesh(d.layers, d.mat);
  mesh.finish();
  // The seed is a hash of the RECIPE, so whatever the recipe does not spell out
  // — which faces offer an anchor — is still fixed forever by the recipe alone.
  const anchors = anchorsFor(rng(seedOf(recipe)), mesh);
  return {
    id: recipe, recipe, name: label(recipe), family: d.family,
    size: [SUB, SUB, SUB], rot: true, layer: 'structure',
    mesh, anchors, tier: PRIMARY, note: recipe,
  };
}

/** Kept for the instruments that want a block and do not care what it is. */
export function composeBlock(seed) {
  return blockFromRecipe(rollRecipe(seed));
}

/* ------------------------------------------------------- the sampler stamp */

/**
 * A PRE-REGISTERED CHECK, and it exists to make one migration refuse itself.
 *
 * Saves written before `piranesi/4` name an anchor site by its INDEX in the list
 * `anchorsFor` deals, so bringing one across means asking today's sampler what
 * it deals and matching by position. That is exact — but only while today's
 * sampler agrees with the one that wrote the file, and **a migration that
 * silently moves every torch is worse than an index that fails visibly.**
 *
 * So the sampler's actual output over a fixed probe is hashed, and the hash is
 * pinned below. Change `anchorsFor`, `backed`, `ANCHOR_Z`, the green lines, or
 * anything under them, and `test/store.test.mjs` fails with a note saying what
 * it means; the migration then refuses rather than guessing, and old saves keep
 * their raw keys until somebody decides what they should become.
 *
 * The probes are one of each family and a spread of masses, so a change that
 * only moves solid blocks' sites is still caught.
 */
const PROBES = [
  'S:full,full,full:stone',
  'S:ell,bar,frame:stone',
  'S:twin,quarters,rounded:rustic',
  'S:bored,cross,tee:stone',
  'A:y+:twin:stone',
  'A:xl:corner:rustic',
  'D:00ii,00ii,00ii:stone',
  'D:00ii,004i!609in,6eii:stone',
];

/** The sampler as it stood when `piranesi/3` files were being written. */
export const SAMPLER = 'yzubdn';

let stamped = null;
export function samplerStamp() {
  if (stamped) return stamped;
  let h = 0x811c9dc5;
  for (const r of PROBES) {
    const def = blockFromRecipe(r);
    const line = `${r}=${def ? def.anchors.map((a) => `${a.side}@${a.u},${a.z}`).join('|') : 'x'};`;
    for (let i = 0; i < line.length; i++) h = Math.imul(h ^ line.charCodeAt(i), 0x01000193);
  }
  stamped = (h >>> 0).toString(36).padStart(6, '0');
  return stamped;
}

/**
 * A hand of blocks to build with.
 *
 * DELIBERATELY A FIXED SET, not "generate a new one every time you place".  A
 * builder needs a vocabulary you can learn — you want to reach for THAT block,
 * the one with the stair going the wrong way.  Endless novelty is the same as
 * no vocabulary at all.  Reroll is a button, not a policy.
 *
 * The hand may be re-dealt freely now.  It is a SHELF, not an identity: what a
 * saved building references is the recipe, so changing what is on the shelf can
 * no longer change what is already built.
 */
export function buildCatalog(count = 24, seed0 = 1) {
  const cat = new Map();
  // A plain solid first, always.  It is the most useful block in the game — it
  // is what makes a run of masonry read as one mass — and leaving it to chance
  // would sometimes deal a hand without one.
  add(cat, `S:full,full,full:stone`);
  let n = 1, i = 1;
  while (n < count && i < count * 8) {
    if (add(cat, rollRecipe(seed0 + i * 7919))) n++;
    i++;
  }
  cat.families = [...new Set([...cat.values()].map((d) => d.family))];
  return cat;
}

/** Put a recipe on the shelf.  Idempotent — a recipe IS its id, so rolling the
 *  same block twice is not a duplicate, it is the same block. */
export function add(cat, recipe) {
  if (cat.has(recipe)) return false;
  const def = blockFromRecipe(recipe);
  if (!def) return false;
  cat.set(recipe, def);
  return true;
}

export { SUB, C as SPRINGING, R_WHOLE };
void arc;
