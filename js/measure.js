// measure.js — WHAT A BLOCK IS LIKE, in numbers, for forty thousand of them.
//
// The catalogue is enumerable (see enumerate.js) but forty thousand blocks is
// far past what anyone can look at, so the question "which ones are the most
// viable" has to be answered by measurement.  This is the measuring.
//
// THE FAST PATH, AND WHY IT IS ALLOWED.  `maskFor` casts sixty-four rays per
// cell against the whole face list — about thirty milliseconds a block, which
// is twenty minutes for the enumeration and unusable.  But a STACK is three
// plans extruded vertically, and a vertical extrusion is constant in z, so:
//
//     a stack's 9x9x9 mask is its three plans' 9x9 masks, each repeated three
//     cells up.
//
// Thirty-four plan masks instead of forty thousand block masks.  That claim was
// not assumed — `--verify` rebuilds blocks through the shipped `maskFor` and
// compares cell for cell, and it is exact on curved, notched, disconnected and
// rotated plans alike.  The plan masks themselves are cut by `solidityMask`,
// the same function the light uses, rather than by a re-derived sampling loop:
// a second copy of the fill threshold is how two answers drift apart.
//
// Arches do not decompose — the springing at 4.5 falls inside a cell — so they
// go the slow way.  There are only a couple of hundred of them.

import { SUB } from './cube.js';
import { PLANS, turnPlan } from './plan.js';
import { Mesh, sweep } from './mesh.js';
import { solidityMask, maskFor } from './solidity.js';
import { decode } from './recipe.js';
import { blockFromRecipe } from './stack.js';

const S = SUB;
const AREA = S * S;
const VOL = S * S * S;

export const idx = (x, y, z) => x + S * (y + S * z);

/* ------------------------------------------------------------- plan masks */

const planCache = new Map();

/**
 * The 9x9 footprint of one plan at one turn, as the light sees it.
 *
 * Built by extruding the plan the full height and asking `solidityMask` for a
 * single layer of cells.  Constant in z, so one layer is the whole answer.
 */
export function planMask(id, q) {
  const key = `${id}/${q}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const m = new Mesh();
  for (const poly of turnPlan(PLANS[id].make(), q)) {
    sweep(m, poly, 'z', 0, S, { mat: 'stone', tag: 'plan', sideA: '-z', sideB: '+z' });
  }
  m.finish();
  const mask = solidityMask(m, [S, S, 1]);
  planCache.set(key, mask);
  return mask;
}

/** The mask of any recipe: fast for stacks, honest for arches. */
export function maskOf(recipe) {
  const d = decode(recipe);
  if (!d.ok) return null;
  if (d.family !== 'stack') return maskFor(blockFromRecipe(recipe));
  const out = new Uint8Array(VOL);
  const per = S / d.layers.length;                 // three cells a storey
  d.layers.forEach((L, i) => {
    const pm = planMask(L.id, L.q);
    for (let z = i * per; z < (i + 1) * per; z++) out.set(pm, AREA * z);
  });
  return out;
}

/* -------------------------------------------------------------- rotations */

/**
 * Turn a mask a quarter about z, matching `turnPlan`'s convention exactly: it
 * sends the point [x,y] to [S-y, x], so the cell (i,j) goes to (S-1-j, i).
 * Getting this backwards would mirror every block in the join analysis and the
 * numbers would still look plausible.
 */
export function turnMask(mask, k) {
  const r = ((k % 4) + 4) % 4;
  if (!r) return mask;
  let cur = mask;
  for (let n = 0; n < r; n++) {
    const out = new Uint8Array(VOL);
    for (let z = 0; z < S; z++) {
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) out[idx(S - 1 - j, i, z)] = cur[idx(i, j, z)];
      }
    }
    cur = out;
  }
  return cur;
}

/* --------------------------------------------------------------- profiles */

export const SIDES = ['-x', '+x', '-y', '+y', '-z', '+z'];
export const OPPOSITE = { '-x': '+x', '+x': '-x', '-y': '+y', '+y': '-y', '-z': '+z', '+z': '-z' };

/**
 * THE SOCKET: which cells of one face of the block hold stone.
 *
 * This is the whole joinery question in one object.  Two blocks set side by
 * side present coincident faces pointing opposite ways, and the renderer's
 * coincidence rule cancels them where BOTH have stone — which is what turns a
 * row of separate boxes into one continuous interior.  Identical profiles
 * cancel completely and the seam disappears.
 *
 * Both faces of a join are read in the same world axes — an x-join compares
 * (y,z) against (y,z) — so the keys are directly comparable and a match means
 * a match.
 */
export function profile(mask, side) {
  const out = new Uint8Array(AREA);
  const at = S - 1;
  for (let b = 0; b < S; b++) {
    for (let a = 0; a < S; a++) {
      let v;
      switch (side) {
        case '-x': v = mask[idx(0, a, b)]; break;
        case '+x': v = mask[idx(at, a, b)]; break;
        case '-y': v = mask[idx(a, 0, b)]; break;
        case '+y': v = mask[idx(a, at, b)]; break;
        case '-z': v = mask[idx(a, b, 0)]; break;
        default: v = mask[idx(a, b, at)];
      }
      out[a + S * b] = v;
    }
  }
  return out;
}

/** A profile as a short interned string — a Map key, never an identity. */
export function keyOf(bits) {
  let s = '';
  for (let i = 0; i < bits.length; i++) s += bits[i] ? '1' : '0';
  return s;
}

export const popcount = (bits) => bits.reduce((n, v) => n + v, 0);

/* --------------------------------------------------------------- the void */

/**
 * Which void cells have stone somewhere above them — the cells that are UNDER
 * something.
 *
 * THE FAULT THIS EXISTS TO KILL, and it was visible in a picture long before it
 * was visible in a number.  A horizontal "way through" was any void path from
 * one face to the opposite one, and a block whose top storey is mostly empty
 * satisfies that through the open air above it.  So `corner`-on-top scored
 * three ways out of three, the ranking filled up with big slabs wearing a small
 * block as a hat, and the contact sheet of "the most viable blocks in the
 * grammar" was sixteen doorsteps.
 *
 * You cannot walk THROUGH a block by walking OVER it.  A passage is roofed.
 */
function roofedCells(mask) {
  const roofed = new Uint8Array(VOL);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let stoneAbove = 0;
      for (let z = S - 1; z >= 0; z--) {
        const c = idx(x, y, z);
        if (mask[c]) { stoneAbove = 1; continue; }
        roofed[c] = stoneAbove;
      }
    }
  }
  return roofed;
}

/**
 * Label the void as connected components and note which faces each one opens
 * onto.  Six-connectivity: a diagonal gap is not a way through, because you
 * cannot walk it and light does not march it.
 *
 * `only` restricts the flood to a subset of the void — passing `roofedCells`
 * gives the covered passages and nothing else.
 */
function voidComponents(mask, only = null) {
  const open = (c) => !mask[c] && (!only || only[c]);
  const lab = new Int32Array(VOL).fill(-1);
  const comps = [];
  const stack = [];
  for (let start = 0; start < VOL; start++) {
    if (!open(start) || lab[start] >= 0) continue;
    const id = comps.length;
    const faces = new Set();
    let size = 0;
    lab[start] = id; stack.push(start);
    while (stack.length) {
      const c = stack.pop();
      size++;
      const x = c % S, y = ((c / S) | 0) % S, z = (c / AREA) | 0;
      if (x === 0) faces.add('-x'); if (x === S - 1) faces.add('+x');
      if (y === 0) faces.add('-y'); if (y === S - 1) faces.add('+y');
      if (z === 0) faces.add('-z'); if (z === S - 1) faces.add('+z');
      if (x > 0) push(c - 1); if (x < S - 1) push(c + 1);
      if (y > 0) push(c - S); if (y < S - 1) push(c + S);
      if (z > 0) push(c - AREA); if (z < S - 1) push(c + AREA);
    }
    comps.push({ size, faces });
    function push(n) { if (open(n) && lab[n] < 0) { lab[n] = id; stack.push(n); } }
  }
  return comps;
}

/** Is there a straight run of void clean through, along this axis? */
function sightline(mask, axis) {
  for (let b = 0; b < S; b++) {
    for (let a = 0; a < S; a++) {
      let clear = true;
      for (let t = 0; t < S && clear; t++) {
        const i = axis === 'x' ? idx(t, a, b) : axis === 'y' ? idx(a, t, b) : idx(a, b, t);
        if (mask[i]) clear = false;
      }
      if (clear) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------- the sheet */

/**
 * Everything measurable about one block that does not depend on the others.
 * The neighbour-dependent part — joinery — needs the whole catalogue and is
 * done by `joinery()` below.
 */
export function measure(recipe, def = null) {
  const d = decode(recipe);
  if (!d.ok) return null;
  const mask = maskOf(recipe);
  if (!mask) return null;

  let mass = 0;
  for (let i = 0; i < VOL; i++) mass += mask[i];

  // Does it stand up?  A block whose upper storey has nothing under it is legal
  // and sometimes wanted — this is Piranesi — but it should be the PLAYER's
  // impossibility, not one the generator hands out by accident.
  //
  // MEASURED ONLY WHERE IT CAN FAIL: at the planes where one slice differs from
  // the one below it.  A stack is three plans extruded, so six of its eight
  // interfaces are interior to a layer and are supported by construction;
  // averaging over all eight buried the two that matter and returned 100% for
  // every block in the catalogue.  A number that agrees with everything is not
  // a measurement.
  let above = 0, held = 0;
  for (let z = 1; z < S; z++) {
    let differs = false;
    for (let c = 0; c < AREA && !differs; c++) {
      if (mask[c + AREA * z] !== mask[c + AREA * (z - 1)]) differs = true;
    }
    if (!differs) continue;
    for (let c = 0; c < AREA; c++) {
      if (!mask[c + AREA * z]) continue;
      above++;
      if (mask[c + AREA * (z - 1)]) held++;
    }
  }

  const base = popcount(profile(mask, '-z'));
  const cap = popcount(profile(mask, '+z'));

  // Sealed chambers are a property of the WHOLE void, so they are found in the
  // unrestricted flood; the ways through are found in the roofed one.
  const comps = voidComponents(mask);
  const covered = voidComponents(mask, roofedCells(mask));
  const through = { x: false, y: false, z: false };
  const open = { x: false, y: false, z: false };
  for (const c of covered) {
    if (c.faces.has('-x') && c.faces.has('+x')) through.x = true;
    if (c.faces.has('-y') && c.faces.has('+y')) through.y = true;
  }
  for (const c of comps) {
    // A shaft cannot be roofed — that is what makes it a shaft — so the
    // vertical way is plain connectivity.
    if (c.faces.has('-z') && c.faces.has('+z')) through.z = true;
    if (c.faces.has('-x') && c.faces.has('+x')) open.x = true;
    if (c.faces.has('-y') && c.faces.has('+y')) open.y = true;
  }
  open.z = through.z;
  const sealed = comps.filter((c) => c.faces.size === 0);

  return {
    recipe,
    mask,
    mass: mass / VOL,
    cells: mass,
    support: above ? held / above : 1,
    base: base / AREA,
    cap: cap / AREA,
    through,
    ways: (through.x ? 1 : 0) + (through.y ? 1 : 0) + (through.z ? 1 : 0),
    // The unroofed count, kept so the difference between "you can get across
    // it" and "you can get through it" stays visible rather than being quietly
    // decided by this file.
    open,
    openWays: (open.x ? 1 : 0) + (open.y ? 1 : 0) + (open.z ? 1 : 0),
    sight: { x: sightline(mask, 'x'), y: sightline(mask, 'y'), z: sightline(mask, 'z') },
    // A void with no way out is a sealed chamber: unreachable, unlightable, and
    // pure cost.  Rare, but it is exactly the sort of thing a full enumeration
    // turns up and a hand of twenty-four never would.
    chambers: sealed.length,
    anchors: def ? def.anchors.length : 0,
    family: d.family,
    // An arch's own axis, so the census can ask the question that matters about
    // it: what can meet the END of a vault, as opposed to its flank.
    axis: d.axis || null,
    hand: d.hand || null,
  };
}

/* --------------------------------------------------------------- joinery */

/**
 * WHICH BLOCKS MEET WHICH, and it is the number the whole cube law was for.
 *
 * For every block, in every one of its four turns, record the profile it
 * presents on each side.  Then a block's `flush` count is how many of its own
 * four sides some OTHER block can meet exactly — and `reach` is how much of the
 * vocabulary can do it, averaged over the sides.
 *
 * Self-matches are excluded.  Every block trivially meets itself in a row, and
 * counting that would flatter exactly the blocks that connect to nothing else.
 */
export function joinery(sheets) {
  const serve = new Map();                        // side -> profile key -> Set(recipe)
  for (const s of SIDES) serve.set(s, new Map());

  for (const sh of sheets) {
    for (let r = 0; r < 4; r++) {
      const m = turnMask(sh.mask, r);
      for (const side of SIDES) {
        // Every side in every turn, decks included: turning a block leaves its
        // top face on top but ROTATES THE PATTERN ON IT, so a block that will
        // not stack on another may well stack on it a quarter turn round.
        const k = keyOf(profile(m, side));
        const bag = serve.get(side);
        let set = bag.get(k);
        if (!set) bag.set(k, (set = new Set()));
        set.add(sh.recipe);
      }
    }
  }

  for (const sh of sheets) {
    let flush = 0, reach = 0;
    const per = {};
    for (const side of SIDES) {
      const k = keyOf(profile(sh.mask, side));
      const set = serve.get(OPPOSITE[side]).get(k);
      const n = set ? set.size - (set.has(sh.recipe) ? 1 : 0) : 0;
      per[side] = n;
      if (side === '-z' || side === '+z') continue;
      if (n > 0) flush++;
      reach += n;
    }
    sh.flush = flush;                              // 0..4 of its walls are met
    sh.reach = reach / 4;                          // by how many blocks, on average
    sh.deck = Math.min(per['-z'], per['+z']);      // and can it join a vertical run
    sh.per = per;
  }

  return serve;
}

/**
 * THE COMPOSITE, and it is a judgement — so it is weighted in the open, and
 * every part is reported beside it so the weights can be argued with.
 *
 * WHAT THE FIRST VERSION GOT WRONG, because it is the whole lesson of running
 * this at all.  It scored a block on whether its walls meet other blocks, how
 * much of it stands on itself, and whether it has decks — and 99.8% of the
 * catalogue came back with four flush walls out of four, every block came back
 * fully supported, and eighty-two tied at a perfect 1.000.  The "ranking" was
 * sorting alphabetically inside one enormous tie.
 *
 * That is not a broken metric so much as a RESULT: the cube law works so well
 * that "does it join" is answered yes for essentially everything, so it cannot
 * separate blocks.  The discriminating question moved — from *whether* a
 * block's walls are met to *how common* they are.  So the scale is now relative
 * to the range actually observed rather than to a notional ideal, which is also
 * what stops it saturating.
 *
 *   reach   how many blocks meet its walls exactly.  Its faces being the
 *           vocabulary's common currency is what makes it useful to reach for.
 *   deck    the same question upward: can it join a vertical run.
 *   way     can you get through it.  A vocabulary of nothing but solids is a
 *           quarry, not a Carceri.
 *   anchor  does it offer somewhere to hang a chain — the secondary forms.
 *   sound   no sealed chambers: a void with no way out is pure cost.
 */
export function rank(sheets) {
  const top = (f) => sheets.reduce((m, s) => Math.max(m, f(s)), 0) || 1;
  const maxReach = top((s) => s.reach), maxDeck = top((s) => s.deck);

  for (const sh of sheets) {
    const parts = {
      reach: sh.reach / maxReach,
      deck: sh.deck / maxDeck,
      way: sh.ways / 3,
      anchor: Math.min(1, sh.anchors / 2),
      sound: sh.chambers ? 0 : sh.support,
    };
    // A wisp is not a block.  Scaled rather than excluded, because where the
    // line falls is a judgement and a hard cut would hide the blocks near it.
    const body = sh.mass > 0.04 ? 1 : sh.mass / 0.04;
    sh.parts = parts;
    sh.score = body * (
      0.30 * parts.reach + 0.14 * parts.deck + 0.28 * parts.way
      + 0.12 * parts.anchor + 0.16 * parts.sound
    );
  }
  return { maxReach, maxDeck };
}
