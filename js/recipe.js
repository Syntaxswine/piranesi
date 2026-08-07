// recipe.js — A BLOCK'S IDENTITY IS ITS RECIPE, and a save carries the recipes.
//
// THE BUG THIS EXISTS TO KILL.  Blocks were generated into a hand — b0…b23 —
// and a save stored the INDEX: `[0,0,0,"b7"]`.  But b7 is not a block, it is a
// position in a list that gets regenerated from a seed every time the page
// loads.  So the moment anything upstream of that generator changes, every
// saved building silently becomes a different building.
//
// Measured, not feared: adding ONE plan to the vocabulary — the most ordinary
// thing a later session does — changed 15 of the 24 blocks in the hand.  The
// save still loads.  Nothing errors.  The walls are just different walls now.
// And the composer had already been replaced once that day.
//
// So: a recipe is a short string that fully determines a block, it is the
// block's id, and a save writes the recipes it uses into its own palette.  A
// saved building carries its blocks with it and cannot be re-dealt by anything.
//
//   S:rounded,ell,frame:stone          a stack of three plans
//   S:bar/1,cross,full:rustic          …with a quarter-turn on the first
//   A:y+:twin/1:stone                  an arch along y, both spandrels, on twin
//   A:xl:corner:rustic                 half an arch along x, left hand only
//
// Readable on purpose.  A save you can open and understand is a save you can
// repair; the previous format was a list of opaque indices into a list that no
// longer existed.
//
// THE GRAMMAR IS THE COMPATIBILITY CONTRACT.  A plan may be added freely — old
// recipes do not mention it and are unaffected, which is the whole point.  A
// plan may NOT be renamed or removed without breaking every recipe that names
// it, so `decode` reports what it could not find rather than quietly
// substituting something; a block that cannot be rebuilt must say so loudly.

import { PLANS } from './plan.js';

/** Plans in a stacked block — one per third of its height.  Lives here rather
 *  than in stack.js because the GRAMMAR owns it: a recipe with the wrong number
 *  of plans is malformed, not merely unusual. */
export const LAYERS = 3;

const MATS = ['stone', 'rustic'];
const HANDS = { '+': 'both', l: 'left', r: 'right' };
const HAND_CH = { both: '+', left: 'l', right: 'r' };

/* ------------------------------------------------------------------ encode */

const layer = (L) => (L.q ? `${L.id}/${L.q}` : L.id);

/** A stacked block: its plans, in order, and its material. */
export const stackRecipe = (layers, mat) => `S:${layers.map(layer).join(',')}:${mat}`;

/** An arch block: axis and hand, the pier plan, and its material. */
export const archRecipe = (axis, hand, pier, mat) =>
  `A:${axis}${HAND_CH[hand]}:${layer(pier)}:${mat}`;

/* ------------------------------------------------------------------ decode */

/**
 * Parse a recipe.  Returns `{ok:false, why}` rather than throwing or guessing —
 * a building that references a block this version cannot build is a thing the
 * player needs told about, not something to paper over with a substitute.
 */
export function decode(recipe) {
  if (typeof recipe !== 'string') return bad(recipe, 'not a string');
  const parts = recipe.split(':');
  const kind = parts[0];

  if (kind === 'S') {
    if (parts.length !== 3) return bad(recipe, 'a stack is S:plans:material');
    const layers = parts[1].split(',').map(parseLayer);
    // ONE PLAN PER THIRD, exactly.  A short stack would extrude only part of
    // the block and leave the rest void, which is a legal-looking block that
    // nothing in the grammar asked for.
    if (layers.length !== LAYERS) {
      return bad(recipe, `a stack needs ${LAYERS} plans, one per third; this has ${layers.length}`);
    }
    const missing = layers.filter((L) => !L || !PLANS[L.id]);
    if (missing.length) return bad(recipe, `no such plan: ${missing.map((m) => m && m.id).join(', ')}`);
    if (!MATS.includes(parts[2])) return bad(recipe, `no such material: ${parts[2]}`);
    return { ok: true, family: 'stack', layers, mat: parts[2], recipe };
  }

  if (kind === 'A') {
    if (parts.length !== 4) return bad(recipe, 'an arch is A:axis+hand:pier:material');
    const axis = parts[1][0], hand = HANDS[parts[1][1]];
    if (axis !== 'x' && axis !== 'y') return bad(recipe, `no such axis: ${axis}`);
    if (!hand) return bad(recipe, `no such hand: ${parts[1][1]}`);
    const pier = parseLayer(parts[2]);
    if (!pier || !PLANS[pier.id]) return bad(recipe, `no such plan: ${pier && pier.id}`);
    if (!MATS.includes(parts[3])) return bad(recipe, `no such material: ${parts[3]}`);
    return { ok: true, family: 'arch', axis, hand, pier, mat: parts[3], recipe };
  }

  return bad(recipe, `no such block kind: ${kind}`);
}

function parseLayer(s) {
  if (!s) return null;
  const [id, q] = s.split('/');
  return { id, q: q ? Number(q) : 0 };
}

const bad = (recipe, why) => ({ ok: false, recipe, why });

/** Every recipe in this list that this version cannot build.  What a loader
 *  shows the player instead of failing silently. */
export function unbuildable(recipes) {
  return recipes.map(decode).filter((d) => !d.ok);
}

/* -------------------------------------------------------------------- seed */

/**
 * A block's seed is a hash of its RECIPE, not of its place in a hand.
 *
 * Everything a recipe does not spell out — which faces offer an anchor, which
 * way the stone grain runs — is derived from this, so two blocks with the same
 * recipe are the same block everywhere and forever, and a block keeps its
 * anchors when the vocabulary grows around it.
 */
export function seedOf(recipe) {
  let h = 2166136261;
  for (let i = 0; i < recipe.length; i++) {
    h ^= recipe.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** A short human label — what the shelf shows, and never an identity. */
export function label(recipe) {
  const d = decode(recipe);
  if (!d.ok) return '?';
  return d.family === 'arch'
    ? `arch ${d.axis}${d.hand === 'both' ? '' : ' ' + d.hand}`
    : d.layers.map((L) => L.id).join(' · ');
}
