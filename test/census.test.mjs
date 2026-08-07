// test/census.test.mjs — the rules the full walk of the grammar depends on.
//
// The census measures forty thousand blocks nobody will ever look at
// individually, so every shortcut it takes has to be pinned by something that
// fails loudly.  Each test here names the symptom, because the failure mode of
// all of them is the same and it is the bad one: a complete-looking catalogue
// that is quietly measuring something else.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SUB } from '../js/cube.js';
import { PLANS, PLAN_IDS, planArea, turnPlan } from '../js/plan.js';
import { LAYERS, stackRecipe } from '../js/recipe.js';
import { blockFromRecipe } from '../js/stack.js';
import { maskFor } from '../js/solidity.js';
import {
  everyBlock, expectedStackBlocks, layerTokens, stackOrbit, archOrbit,
  turnStack, turnArch, least,
} from '../js/enumerate.js';
import {
  measure, maskOf, planMask, turnMask, keyOf, profile, joinery, rank, idx,
} from '../js/measure.js';

/* ------------------------------------------------------------------- mass */

test('a plan\'s mass is measured from its polygons, never written down beside them', () => {
  // THE SYMPTOM: `ell-deep` declared 0.56 while `ell(6)` covers 0.89 of the
  // square — 0.56 is the area of `ell(3)`, so the number recorded what the plan
  // was MEANT to be while the geometry did something else.  Nothing could
  // notice, and rollRecipe sorts a stack heaviest-first, so a nearly solid plan
  // sorted as though it were half air.
  for (const id of PLAN_IDS) {
    const m = planArea(PLANS[id].make()) / (SUB * SUB);
    assert.equal(PLANS[id].mass, m, `${id} mass must be its own area`);
  }
  assert.ok(Math.abs(PLANS['ell-deep'].mass - 0.889) < 0.002, 'ell-deep covers 8/9 of the square');
  assert.ok(PLANS['ell-deep'].mass > PLANS.ell.mass, 'ell(6) leaves MORE stone than ell(4.5)');
});

/* --------------------------------------------------------- the fast path */

test('an assembled mask is the ray-cast mask, cell for cell', () => {
  // THE SYMPTOM: nothing.  The census would measure forty thousand blocks that
  // are not the blocks the game builds, and every number in it would be wrong
  // in a way no picture would show.
  const sample = [
    'S:full,full,full:stone', 'S:ell,bar/1,frame:stone', 'S:bore,drum,quarters:stone',
    'S:rounded,shaft,cross:stone', 'S:corner/2,tee/3,notch/1:stone',
    'S:twin/1,bar-wide,ell-deep/3:stone',
  ];
  for (const r of sample) {
    const fast = maskOf(r), slow = maskFor(blockFromRecipe(r));
    assert.deepEqual([...fast], [...slow], `${r} must assemble to its ray-cast mask`);
  }
});

test('every plan\'s declared turns is its true period', () => {
  // Too low and the generator never offers blocks that exist; too high and it
  // offers the same block four times and calls it variety.  Both are silent.
  for (const id of PLAN_IDS) {
    const m0 = keyOf(planMask(id, 0));
    let period = 4;
    for (let q = 1; q < 4; q++) if (keyOf(planMask(id, q)) === m0) { period = q; break; }
    assert.equal(PLANS[id].turns, period, `${id} declares ${PLANS[id].turns} turns`);
  }
});

/* --------------------------------------------------------------- turning */

test('turning a mask four times is doing nothing, and matches turnPlan', () => {
  const m = maskOf('S:corner/2,tee/3,notch/1:stone');
  assert.deepEqual([...turnMask(m, 4)], [...m], 'four quarters is a whole turn');
  assert.notDeepEqual([...turnMask(m, 1)], [...m], 'one quarter is not');
  // The convention has to be turnPlan's, or the join analysis is mirrored and
  // every number in it still looks plausible.  turnPlan sends [x,y] to [S-y,x],
  // so the cell (i,j) goes to (S-1-j, i).
  const t = turnMask(m, 1);
  for (let z = 0; z < SUB; z++) {
    for (let j = 0; j < SUB; j++) {
      for (let i = 0; i < SUB; i++) {
        assert.equal(t[idx(SUB - 1 - j, i, z)], m[idx(i, j, z)]);
      }
    }
  }
});

test('a quarter turn of an arch is the arch enumerate.js says it is', () => {
  // Derived from how vault() sweeps and how halfVault() picks a hand — exactly
  // the sort of derivation that comes out mirrored and still reads sensibly.
  // A wrong rule merges two arches that are not the same block, and the missing
  // one leaves nothing behind to show it was ever there.
  for (const axis of ['x', 'y']) {
    for (const hand of ['both', 'left', 'right']) {
      const a = { pier: { id: 'twin', q: 1 }, axis, hand };
      const [r0, r1] = archOrbit(a);
      assert.equal(keyOf(turnMask(maskOf(r0), 1)), keyOf(maskOf(r1)),
        `turning ${r0} must give ${r1}`);
    }
  }
});

test('a canonical recipe is the same whichever turn of the block you start from', () => {
  const tokens = layerTokens();
  let layers = [tokens[3], tokens[11], tokens[20]];
  const rep = least(stackOrbit(layers));
  for (let r = 0; r < 4; r++) {
    layers = turnStack(layers);
    assert.equal(least(stackOrbit(layers)), rep, 'an orbit has one representative');
  }
  let a = { pier: { id: 'tee', q: 2 }, axis: 'x', hand: 'left' };
  const arep = least(archOrbit(a));
  for (let r = 0; r < 4; r++) {
    a = turnArch(a);
    assert.equal(least(archOrbit(a)), arep);
  }
});

/* ---------------------------------------------------------- the counting */

test('walking the grammar and counting its orbits give the same number', () => {
  // Two independent derivations of the vocabulary's real size: one walks every
  // stack and collapses the turns, the other is Burnside straight off the
  // plans' declared symmetries.  An enumerator that quietly drops blocks is the
  // worst failure available here, because the catalogue looks complete.
  const E = everyBlock();
  assert.equal(E.stackBlocks, expectedStackBlocks());
  assert.equal(E.tokens, PLAN_IDS.reduce((n, id) => n + PLANS[id].turns, 0));
  assert.equal(E.solids, E.tokens ** LAYERS + E.tokens * 2 * 3);
  assert.equal(E.recipeCount, E.solids * 2, 'material is a skin, so exactly double');
  // Every recipe it emits must actually build.
  for (const r of [E.recipes[0], E.recipes[500], E.recipes.at(-1)]) {
    assert.ok(blockFromRecipe(r), `${r} must build`);
  }
});

/* --------------------------------------------------------- the measuring */

test('support is measured where it can fail, not averaged into meaninglessness', () => {
  // THE SYMPTOM: every one of 10,826 blocks came back 100% supported.  A stack
  // is three plans extruded, so six of its eight interfaces are interior to a
  // layer and cannot fail by construction; averaging over all eight buries the
  // two that matter.  A number that agrees with everything is not a measurement.
  const solid = measure('S:full,full,full:stone');
  assert.equal(solid.support, 1, 'a solid block is wholly carried');
  // A drum carrying a full storey: only the drum's own footprint is held up.
  const perched = measure('S:drum,full,full:stone');
  assert.ok(perched.support < 0.4, `a slab on a drum is mostly unsupported, got ${perched.support}`);
});

test('you cannot walk THROUGH a block by walking OVER it', () => {
  // THE SYMPTOM, and it showed in a picture before it showed in a number: the
  // contact sheet of "the most viable blocks in the grammar" was sixteen big
  // slabs wearing a small block as a hat.  A horizontal way through was any
  // void path from face to opposite face, which a mostly-empty top storey
  // satisfies through the open air above the block — so `corner`-on-top scored
  // a perfect three ways out of three and took over the ranking.
  const doorstep = measure('S:notch,notch,corner/3:stone');
  assert.equal(doorstep.openWays, 3, 'unroofed, you can cross it every way');
  assert.equal(doorstep.through.x, false, 'but that is walking over the roof');
  assert.equal(doorstep.through.y, false);

  // A bar roofed by a solid storey is a tunnel, and must still count.
  const tunnel = measure('S:full,bar,full:stone');
  assert.equal(tunnel.through.x, true, 'a covered passage is a way through');

  // Two walls with a full-height slot between them are not a tunnel: no roof.
  const slot = measure('S:twin,twin,twin:stone');
  assert.equal(slot.through.x, false);
  assert.equal(slot.through.y, false);

  const solid = measure('S:full,full,full:stone');
  assert.deepEqual(solid.through, { x: false, y: false, z: false });
  assert.equal(solid.ways, 0);

  // A shaft cannot be roofed — that is what makes it a shaft.
  assert.equal(measure('S:bore,bore,bore:stone').through.z, true);

  // And an arch is the covered passage, which is the whole reason R_WHOLE exists.
  assert.equal(measure('A:y+:twin:stone').through.y, true);
});

test('a sealed chamber is found: a drum plugging the shaft above it', () => {
  // The plug fills the bore from below and the lid closes it from above, so the
  // hole becomes a closed column of air inside the masonry — unreachable and
  // unlightable.  The sort of thing a full walk turns up and a hand of
  // twenty-four never would.
  assert.equal(measure('S:drum,shaft,full:stone').chambers, 1);
  assert.equal(measure('S:full,full,full:stone').chambers, 0);
});

test('a solid block presents a solid wall on every side', () => {
  const m = maskOf('S:full,full,full:stone');
  for (const side of ['-x', '+x', '-y', '+y', '-z', '+z']) {
    assert.equal(keyOf(profile(m, side)), '1'.repeat(SUB * SUB), `${side} must be solid`);
  }
});

/* ----------------------------------------------------------- the ranking */

test('the viability score discriminates instead of saturating', () => {
  // THE SYMPTOM: a top-forty table that is really an alphabetical listing.  The
  // first version scored flush walls, support and decks — and 99.8% of blocks
  // had four flush walls out of four, every block was fully supported, and 82
  // tied at a perfect 1.000.  That is a RESULT about the cube law, not merely a
  // bad metric: "does it join" is answered yes for almost everything, so it
  // cannot separate blocks.
  const recipes = everyBlock().recipes.filter((_, i) => i % 37 === 0);
  const sheets = recipes.map((r) => measure(r, blockFromRecipe(r))).filter(Boolean);
  joinery(sheets);
  rank(sheets);
  const distinct = new Set(sheets.map((s) => s.score.toFixed(4))).size;
  assert.ok(distinct > sheets.length / 4,
    `${distinct} distinct scores across ${sheets.length} blocks is not a ranking`);
  for (const s of sheets) assert.ok(s.score >= 0 && s.score <= 1, 'a score is a fraction');
});

test('a block is never counted as meeting itself', () => {
  // Every block trivially meets itself in a row.  Counting that would flatter
  // exactly the blocks that connect to nothing else — and the one true dead end
  // in the grammar would score as well as anything.
  const lone = measure('S:rounded,rounded,rounded:stone');
  const sheets = [lone];
  joinery(sheets);
  assert.equal(lone.flush, 0, 'the all-rounded block can only ever meet itself');
});
