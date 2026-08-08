// naming.js — A BLOCK'S NAME IS COMPUTED FROM ITS RECIPE, NEVER TYPED BESIDE IT.
//
//   "a procedural naming structure might be a good idea too, so that the save
//    file automatically knows what type of block it is."
//
// It is the same law as `plan.js` §MASS, applied to words instead of numbers.
// `ell-deep` declared `mass: 0.56` for geometry covering 0.889, and the two had
// no way of noticing they disagreed: a derived quantity written down by hand
// next to the thing it derives from is a bug with a delay on it. A NAME is
// exactly that kind of quantity. Let the player type "stair north" beside a
// recipe and the day they edit the recipe the label starts lying, silently,
// forever — and a save file full of lying labels is worse than one with none.
//
// So: the name is a function of the recipe, regenerated every time the file is
// read, and it can no more drift than the mass can.
//
// WHAT IT SAYS, and this is his own classification rather than one invented for
// the occasion:
//
//   "what i am thinking is we can take these elements and then think about the
//    standard junctions, is it +, T, I, L, C, etc."
//
//     x-ramp-n-4f2
//     │ │      └── three characters of the recipe's own hash — a specimen
//     │ │          number, so two blocks that are alike stay tellable apart
//     │ └───────── what makes it that block: the rarest thing about it
//     └─────────── HIS JUNCTION: how many sides you can walk into, and how
//
// The junction comes from `aperture.js`, which already implements his notation
// — sides clockwise from twelve, a letter for the opening type, a digit for the
// floor — under his own rule that for walkable space you get one opening per
// level. So the name is not a summary of the block, it is a READING of it, by
// the same instrument that decided which blocks can meet which.
//
// THE SUFFIX HASHES THE RECIPE, NOT THE SHAPE, and that is deliberate. Hashing
// the solidity mask would give two blocks of the same shape one name, which is
// tempting — but the mask is one cell to the yard and cannot see a corner
// round, so `rounded` and `full` would come out identically named while looking
// nothing alike. The recipe is the identity. The name is a handle on it.

import { decode, seedOf } from './recipe.js';
import { blockFromRecipe } from './stack.js';
import { measure, profile, keyOf } from './measure.js';
import { junctionOnFloor, junctionsOf, signature } from './aperture.js';

/** His junction classes, as tokens that survive being a filename and sort into
 *  useful groups. `x` is the crossing, `shut` is the one with no way in. */
const JUNCTION = {
  '+': 'x', T: 't', I: 'i', L: 'l', 'dead-end': 'end', sealed: 'shut',
};

/** Plans worth naming a block after, rarest first. A block is named for the
 *  most distinguishing thing about it, because that is what you are scanning a
 *  shelf for — nobody looks for "the one with a wall in it". */
const PLAN_FEATURE = [
  ['bore', 'bore'], ['shaft', 'shaft'], ['drum', 'drum'],
  ['rounded', 'round'], ['quarters', 'columns'],
  ['frame', 'court'], ['cross', 'cross'], ['tee', 'tee'],
  ['wall-curve', 'curve'], ['wall-tee', 'wall-tee'], ['twin', 'twin'],
  ['stub', 'pier'], ['corner-small', 'corner'], ['notch', 'notch'],
];

/* --------------------------------------------------------------- the name */

const cache = new Map();

/**
 * The procedural name. Deterministic, cached, and safe to put in a filename.
 * Costs one mesh build and one mask the first time it sees a recipe (~15 ms),
 * which is why it is not `recipe.js label()` — that one has to stay free.
 */
export function nameOf(recipe) {
  const d = describe(recipe);
  return d ? d.name : '?';
}

/**
 * The full reading of a block. `null` if this version cannot build it — a
 * recipe that will not decode has no type to report, and inventing one would be
 * the substitution this project refuses everywhere else.
 */
export function describe(recipe) {
  if (cache.has(recipe)) return cache.get(recipe);
  const out = read(recipe);
  cache.set(recipe, out);
  return out;
}

function read(recipe) {
  const d = decode(recipe);
  if (!d.ok) return null;
  const def = blockFromRecipe(recipe);
  if (!def) return null;
  const sh = measure(recipe, def);
  if (!sh) return null;

  const profileFor = (side) => keyOf(profile(sh.mask, side));
  // THE GROUND FLOOR, not "anywhere up the block" — see aperture.js
  // `junctionOnFloor` for the measurement that decided it. Naming a block for
  // its porosity gets you `+` ninety-three times in a hundred.
  const junction = junctionOnFloor(profileFor, 0);
  const storeys = junctionsOf(profileFor);
  const feature = featureOf(d, sh);
  const id = seedOf(recipe).toString(36).slice(-3).padStart(3, '0');
  const name = `${JUNCTION[junction] || 'x'}-${feature}-${id}`;

  const notes = [];
  if (sh.chambers) notes.push(`${sh.chambers} sealed chamber${sh.chambers > 1 ? 's' : ''}`);
  if (sh.through.z) notes.push('open to the sky');
  if (sh.support < 0.6) notes.push(`${Math.round((1 - sh.support) * 100)}% unsupported`);
  if (def.anchors.length) notes.push(`${def.anchors.length} anchor${def.anchors.length > 1 ? 's' : ''}`);

  return {
    recipe,
    name,
    junction,
    /** The junction of each storey — a section through the block. */
    storeys,
    feature,
    family: d.family,
    signature: signature(profileFor),
    mass: sh.mass,
    ways: sh.ways,
    notes,
    /** One line, for the comment above a recipe in a saved shelf. */
    line: `${name} · ${storeys.join(' ')} · ${Math.round(sh.mass * 100)}% stone`
      + (notes.length ? ` · ${notes.join(', ')}` : ''),
  };
}

/**
 * WHAT MAKES IT THAT BLOCK. Ordered by how much it tells you, not by how much
 * of the block it is: a ramp is one wedge in twenty-seven cells and it is the
 * first thing you would say about the block that has one.
 */
function featureOf(d, sh) {
  if (d.family === 'arch') return `vault-${d.axis}${d.hand === 'both' ? '' : d.hand[0]}`;

  if (d.family === 'drawn') {
    for (const L of d.layers) if (L.ramps.length) return `ramp-${L.ramps[0].dir}`;
    for (const [tok, word] of [['b', 'bore'], ['s', 'shaft'], ['d', 'drum']]) {
      if (d.layers.some((L) => L.disc === tok)) return word;
    }
    if (d.layers.some((L) => [...L.corners].some((c) => c === 'o'))) return 'columns';
    if (d.layers.some((L) => L.corners !== '....')) return 'round';
  } else {
    const ids = d.layers.map((L) => L.id);
    for (const [id, word] of PLAN_FEATURE) if (ids.includes(id)) return word;
  }

  // Nothing rare in it, so name it for its character.
  if (sh.chambers) return 'chamber';
  if (sh.mass > 0.92) return 'solid';
  if (sh.mass < 0.18) return 'open';
  if (sh.through.z) return 'well';
  if (sh.ways >= 2) return 'hall';
  return sh.mass > 0.55 ? 'mass' : 'bay';
}

/* ------------------------------------------------------------- the shelf */

/**
 * A SHELF OF BLOCKS AS A FILE, and deliberately the file this repo already has:
 * one recipe a line, which is what `docs/kit.txt` and `docs/shelf.txt` are and
 * what `tools/blockshot.mjs --recipes @file` eats. So a shelf you export is
 * drawable by every instrument in the project the moment it lands on disk —
 * no new format, no converter, nothing to keep in step.
 *
 * The names ride along as `#` comments, which is the only place a derived thing
 * belongs: a reader that ignores comments gets exactly the recipes, and a
 * reader that shows them gets the names REGENERATED rather than trusted.
 */
export function shelfToText(recipes, title = 'a shelf of blocks') {
  const lines = [`# piranesi — ${title}`,
    '# One recipe a line. The names are DERIVED and regenerated on read;',
    '# editing one changes nothing. The recipe is the block.',
    ''];
  for (const r of recipes) {
    const d = describe(r);
    lines.push(`# ${d ? d.line : 'this version cannot build the next line'}`);
    lines.push(r);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * …and back. Comments are dropped, blank lines are dropped, and every recipe
 * that will not decode is REPORTED rather than skipped — importing a file and
 * quietly getting fewer blocks than it contains is the failure this whole
 * project is arranged against.
 */
export function shelfFromText(text) {
  const recipes = [];
  const bad = [];
  const seen = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    for (const tok of line.split(/[\s;]+/).filter(Boolean)) {
      if (seen.has(tok)) continue;            // a recipe IS the block; twice is once
      seen.add(tok);
      (decode(tok).ok ? recipes : bad).push(tok);
    }
  }
  return { recipes, bad };
}
