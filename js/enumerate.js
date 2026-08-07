// enumerate.js — EVERY BLOCK THE GRAMMAR ADMITS, not a hand dealt from a seed.
//
// buildCatalog() deals twenty-four blocks out of eighty thousand and the other
// seventy-nine thousand have never been looked at.  Nobody knows what is in
// there.  This walks the whole space so it can be counted, measured and ranked
// — "procedurally generate every combination of blocks, catalog them, then see
// which ones are the most viable."
//
// THREE DIFFERENT NUMBERS, and keeping them apart is most of the work here.
//
//   RECIPES     every string the grammar admits.  ~79k.
//   SOLIDS      recipes that differ as geometry.  Material is a skin — `stone`
//               and `rustic` are the same stone in a different mood — so this
//               is exactly half.
//   BLOCKS      solids that differ once you are allowed to TURN one.  A block
//               and the same block rotated a quarter are one block, because
//               rotation is free at placement (`rot: true`, World.place takes
//               a turn).  Enumerating all four is offering the player the same
//               block four times and calling it variety.
//
// The last is the real size of the vocabulary, and it is about a quarter of the
// second — which means three quarters of any "every combination" catalogue is
// the same block wearing a different label.
//
// CANONICAL FORM IS SYMBOLIC, NOT MEASURED.  The representative of an orbit is
// the lexicographically smallest recipe among its four turns.  That can never
// conflate two blocks that merely happen to occupy the same cells at the mask's
// resolution — a drum and a square pillar are not the same block even where the
// light cannot tell.  Those collisions are real and worth knowing about, so the
// census MEASURES them separately and reports them as a finding.

import { PLANS, PLAN_IDS } from './plan.js';
import { stackRecipe, archRecipe, LAYERS } from './recipe.js';

export const MATERIALS = ['stone', 'rustic'];
export const AXES = ['x', 'y'];
export const HANDS = ['both', 'left', 'right'];

/* ------------------------------------------------------------ the alphabet */

/**
 * Every distinct thing a single layer may be: a plan, and one of its turns.
 *
 * `turns` is the plan's own claim about its symmetry — 1 for the four-fold ones
 * so the generator does not offer four copies of a cross.  The census does not
 * take that claim on trust; it measures each plan's true period and says so if
 * the table is lying, because a wrong `turns` either hides distinct blocks or
 * inflates the count with duplicates, and both are silent.
 */
export function layerTokens() {
  const out = [];
  for (const id of PLAN_IDS) {
    for (let q = 0; q < PLANS[id].turns; q++) out.push({ id, q });
  }
  return out;
}

/** Turn one layer token a quarter, staying inside the plan's own period. */
export const turnToken = ({ id, q }, r) => ({ id, q: (q + r) % PLANS[id].turns });

/* --------------------------------------------------------------- the walk */

/**
 * Every stack: one token per third, in order.  An odometer rather than three
 * nested loops, so LAYERS stays a number the grammar owns and not a shape baked
 * into this file.
 */
export function* stacks(tokens = layerTokens()) {
  const n = tokens.length;
  const odo = new Array(LAYERS).fill(0);
  for (;;) {
    yield odo.map((i) => tokens[i]);
    let k = LAYERS - 1;
    while (k >= 0 && ++odo[k] === n) odo[k--] = 0;
    if (k < 0) return;
  }
}

/** Every arch: a pier token, an axis, a hand. */
export function* arches(tokens = layerTokens()) {
  for (const pier of tokens) {
    for (const axis of AXES) for (const hand of HANDS) yield { pier, axis, hand };
  }
}

/* ----------------------------------------------------------- the rotation */

/**
 * ONE QUARTER TURN OF AN ARCH.
 *
 * Derived from the geometry rather than guessed, and then checked: `vault(axis)`
 * sweeps its spandrel profile ALONG `axis`, and `halfVault`'s "left" keeps the
 * spandrel on the low side of the other horizontal axis.  Turning maps x to y,
 * so the axis always swaps; the hand only flips on the half of the turn where
 * the low side becomes the high one.  Walking it round four times:
 *
 *     (y,left) → (x,left) → (y,right) → (x,right) → (y,left)
 *
 * so a turn flips the hand exactly when it starts on x.  `both` is symmetric and
 * never flips.
 *
 * THE CENSUS VERIFIES THIS AGAINST THE MESH.  A rotation rule is the sort of
 * thing that is easy to get backwards and impossible to notice: a wrong one
 * would merge two arches that are not the same block, and the catalogue would
 * simply be missing one with nothing to show that it ever existed.
 */
export function turnArch({ pier, axis, hand }) {
  return {
    pier: turnToken(pier, 1),
    axis: axis === 'x' ? 'y' : 'x',
    hand: axis === 'x' ? flipHand(hand) : hand,
  };
}

const flipHand = (h) => (h === 'left' ? 'right' : h === 'right' ? 'left' : 'both');

/** One quarter turn of a stack: every layer turns together. */
export const turnStack = (layers) => layers.map((L) => turnToken(L, 1));

/* ------------------------------------------------------- canonical recipes */

/** The four turns of a stack, as recipes. */
export function stackOrbit(layers, mat = 'stone') {
  const out = [];
  let cur = layers;
  for (let r = 0; r < 4; r++) { out.push(stackRecipe(cur, mat)); cur = turnStack(cur); }
  return out;
}

/** The four turns of an arch, as recipes. */
export function archOrbit(a, mat = 'stone') {
  const out = [];
  let cur = a;
  for (let r = 0; r < 4; r++) {
    out.push(archRecipe(cur.axis, cur.hand, cur.pier, mat));
    cur = turnArch(cur);
  }
  return out;
}

/** The smallest of a set of strings — an orbit's representative. */
export const least = (a) => a.reduce((m, s) => (s < m ? s : m));

/**
 * EVERY BLOCK, ONCE.
 *
 * Returns the canonical recipes in a stable order, plus the accounting that
 * makes the three numbers above legible.  All geometry is `stone`; the material
 * is carried separately because doubling the catalogue to record a change of
 * mood would be a waste of everyone's time, the owner's most of all.
 */
export function everyBlock() {
  const tokens = layerTokens();
  const seen = new Set();
  const list = [];
  let solids = 0;

  for (const layers of stacks(tokens)) {
    solids++;
    const rep = least(stackOrbit(layers));
    if (seen.has(rep)) continue;
    seen.add(rep); list.push(rep);
  }
  const stackBlocks = list.length;

  for (const a of arches(tokens)) {
    solids++;
    const rep = least(archOrbit(a));
    if (seen.has(rep)) continue;
    seen.add(rep); list.push(rep);
  }

  return {
    recipes: list,
    tokens: tokens.length,
    solids,
    recipeCount: solids * MATERIALS.length,
    stackBlocks,
    archBlocks: list.length - stackBlocks,
  };
}

/**
 * What the orbit count OUGHT to be, from Burnside's lemma, computed straight
 * off the plans' declared symmetries.  A separate derivation of the same
 * number: if walking the space and counting the group's orbits disagree, one of
 * them is wrong, and an enumerator that quietly drops blocks is the worst
 * possible failure here — the catalogue would look complete.
 */
export function expectedStackBlocks() {
  const fixedBy = (r) =>
    PLAN_IDS.reduce((n, id) => {
      const t = PLANS[id].turns;
      // Tokens of this plan that r leaves alone: all of them when r is a
      // multiple of the plan's period, none otherwise.
      return n + (r % t === 0 ? t : 0);
    }, 0);
  let sum = 0;
  for (let r = 0; r < 4; r++) sum += fixedBy(r) ** LAYERS;
  return sum / 4;
}
