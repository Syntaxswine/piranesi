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
import { SUB, R_WHOLE, PRIMARY } from './cube.js';
import { PLANS, PLAN_IDS, turnPlan } from './plan.js';
import { vault, halfVault, tagFlat } from './forms.js';
import { insideMesh } from './solidity.js';
import { arc } from './mesh.js';

const S = SUB;
const C = S / 2;
export const LAYERS = 3;
/** The horizontal cuts a stacked block uses: his "basic 1/3rd slices".  Finer
 *  ones are legal — 2, 2.5, 6.5 and 7 are slice planes too — but he stuck to
 *  thirds and thirds are what make a stack read as storeys. */
export const DECKS = [0, 3, 6, 9];

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

/**
 * Extrude one plan between two heights.
 *
 * The caps take `-z`/`+z` only at the block's own floor and ceiling.  An
 * interior deck is NOT a boundary — tagging it as one would let it cancel
 * against the block above, and a floor you can fall through is worse than a
 * floor drawn twice.
 */
function extrude(m, polys, z0, z1, mat, tag) {
  for (const poly of polys) {
    sweep(m, poly, 'z', z0, z1, {
      mat, tag,
      sideA: z0 === 0 ? '-z' : null,
      sideB: z1 === S ? '+z' : null,
      hatch: 'v',
    });
  }
}

/** A stacked block: one plan per third. */
function stackMesh(layers, mat) {
  const m = new Mesh();
  layers.forEach((L, i) => {
    const polys = turnPlan(PLANS[L.id].make(), L.q);
    extrude(m, polys, DECKS[i], DECKS[i + 1], mat, `layer${i}:${L.id}`);
  });
  tagFlat(m);
  return m;
}

/** An arch block: piers to the springing, the whole-block vault above. */
function archMesh(pier, axis, hand, mat) {
  const m = new Mesh();
  extrude(m, turnPlan(PLANS[pier.id].make(), pier.q), 0, C, mat, `pier:${pier.id}`);
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
 * One block.  Deterministic in `seed` and nothing else.
 * @returns {{seed, mesh, recipe, family, anchors}}
 */
export function composeBlock(seed) {
  const r = rng(seed);
  const mat = chance(r, 0.12) ? 'rustic' : 'stone';

  if (chance(r, 0.34)) {
    // ARCH.  The pier plan is drawn from the ones that leave a way through,
    // because a vault standing on a solid block is a lid, not an arch.
    const pierId = pick(r, ['twin', 'bar', 'bar-wide', 'corner', 'quarters', 'ell', 'tee']);
    const pier = { id: pierId, q: irange(r, 0, PLANS[pierId].turns - 1) };
    const axis = chance(r, 0.5) ? 'x' : 'y';
    const hand = chance(r, 0.72) ? 'both' : (chance(r, 0.5) ? 'left' : 'right');
    const mesh = archMesh(pier, axis, hand, mat);
    mesh.finish();
    return {
      seed, mesh, family: 'arch',
      recipe: [`arch ${axis}${hand === 'both' ? '' : ' ' + hand}`, `on ${pierId}${pier.q ? '/' + pier.q : ''}`, mat],
      anchors: anchorsFor(r, mesh),
    };
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
  const mesh = stackMesh(layers, mat);
  mesh.finish();
  return {
    seed, mesh, family: 'stack',
    recipe: layers.map((L) => L.id + (L.q ? '/' + L.q : '')).concat(mat),
    anchors: anchorsFor(r, mesh),
  };
}

/**
 * A hand of blocks to build with.
 *
 * DELIBERATELY A FIXED SET, not "generate a new one every time you place".  A
 * builder needs a vocabulary you can learn — you want to reach for THAT block,
 * the one with the stair going the wrong way.  Endless novelty is the same as
 * no vocabulary at all.  Reroll is a button, not a policy.
 */
export function buildCatalog(count = 24, seed0 = 1) {
  const cat = new Map();
  // A plain solid first, always.  It is the most useful block in the game — it
  // is what makes a run of masonry read as one mass — and leaving it to chance
  // would sometimes deal a hand without one.
  const s = composeBlockFixed('full');
  cat.set('b0', { ...s, id: 'b0' });
  for (let i = 1; i < count; i++) {
    const b = composeBlock(seed0 + i * 7919);
    cat.set(`b${i}`, {
      id: `b${i}`, name: `${b.family} ${String(b.seed).slice(-4)}`,
      family: b.family, size: [SUB, SUB, SUB], rot: true, layer: 'structure',
      mesh: b.mesh, recipe: b.recipe, seed: b.seed, anchors: b.anchors,
      tier: PRIMARY, note: b.recipe.join(' + '),
    });
  }
  cat.families = [...new Set([...cat.values()].map((d) => d.family))];
  return cat;
}

function composeBlockFixed(planId) {
  const mesh = stackMesh(Array.from({ length: LAYERS }, () => ({ id: planId, q: 0 })), 'stone');
  mesh.finish();
  return {
    name: planId, family: 'solid', size: [SUB, SUB, SUB], rot: false, layer: 'structure',
    mesh, recipe: [planId], seed: 0, anchors: [], tier: PRIMARY, note: planId,
  };
}

export { SUB, C as SPRINGING, R_WHOLE };
void arc;
