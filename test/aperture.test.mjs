// test/aperture.test.mjs — the interface described as OPENINGS.
//
// "i think i need to think about it in terms of intersections, where are the
//  openings, how big are they, etc."
//
// The claims below are what make the interface system small enough to design
// with, so each is pinned against the whole grammar rather than a sample.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SUB } from '../js/cube.js';
import { PLANS, PLAN_IDS } from '../js/plan.js';
import { everyBlock } from '../js/enumerate.js';
import { measure, joinery, planMask, keyOf, profile } from '../js/measure.js';
import { blockFromRecipe } from '../js/stack.js';
import {
  WORDS, ODD_WORDS, wordOf, wordsOfWall, openings, describeWall, wordsByPlan,
} from '../js/aperture.js';

const sheets = everyBlock().recipes.map((r) => measure(r, blockFromRecipe(r))).filter(Boolean);
const serve = joinery(sheets);
const WALLS = ['-x', '+x', '-y', '+y'];

test('the whole grammar speaks seventeen edge words, and a dozen carry it', () => {
  // THE FINDING: of 512 possible nine-bit words the grammar uses a couple of
  // dozen, and three of those occur only in arches. That is what turns "an
  // opaque 81-bit wall pattern" into "three storeys, each one of a dozen words".
  //
  // It was THIRTEEN before the wall family and FIFTEEN after. Seventeen is
  // where R = 2 left it: the corner arcs now cross their edges on planes, so
  // `wall-tee` and `wall-curve` present two new handed words — AND `rounded`
  // gave one up, because a round of 2 bites less than a whole sub-block out of
  // the corner and its wall reads as solid. That is the trade, and it was worth
  // taking: the word `rounded` lost was one nothing else could answer.
  const seen = new Map();
  for (const side of WALLS) {
    for (const [key, set] of serve.get(side)) {
      for (const w of wordsOfWall(key)) seen.set(w, (seen.get(w) || 0) + set.size);
    }
  }
  assert.equal(seen.size, 17, 'seventeen words, no more and no fewer');
  for (const w of WORDS) {
    // `chamfer` is the one word in the named list that no longer occurs — it
    // was `rounded`'s alone and `rounded` stopped speaking it at R = 2.
    if (w.bits === '011111110') { assert.ok(!seen.has(w.bits), 'chamfer is gone with the 2.5 round'); continue; }
    assert.ok(seen.has(w.bits), `${w.name} must occur`);
  }
  for (const w of ODD_WORDS) assert.ok(seen.has(w), 'the vestigial words are real, just rare');

  // A dozen carry essentially all of it.
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  const odd = ODD_WORDS.reduce((n, w) => n + seen.get(w), 0);
  assert.ok(odd / total < 0.001, `the vestigial words are ${(100 * odd / total).toFixed(3)}% of the grammar`);
});

test('the three irregular words come from arches, and only from arches', () => {
  // The vault curve is the one thing in the game that does not land on a
  // storey, so it is the only source of an aperture off the grid.
  for (const side of WALLS) {
    for (const [key, set] of serve.get(side)) {
      if (!wordsOfWall(key).some((w) => ODD_WORDS.includes(w))) continue;
      for (const r of set) assert.equal(r[0], 'A', `${r} is not an arch but speaks an irregular word`);
    }
  }
});

test('every opening is 3, 6 or 9 yards tall with its sill at 0, 3 or 6 — except in arches', () => {
  // A block is three plans extruded, so there is no design freedom in the
  // vertical at all: an opening occupies one storey, two, or all three.
  for (const side of WALLS) {
    for (const [key, set] of serve.get(side)) {
      const isArch = [...set].every((r) => r[0] === 'A');
      for (const o of openings(key)) {
        if (isArch) continue;
        assert.ok([3, 6, 9].includes(o.height), `height ${o.height} on ${[...set][0]}`);
        assert.ok([0, 3, 6].includes(o.sill), `sill ${o.sill} on ${[...set][0]}`);
      }
    }
  }
});

test('two plans are the sole source of a word, and it costs them dearly', () => {
  // THE MECHANISM that used to produce the census's one dead end, and it
  // generalises: a plan that alone emits a word can only ever meet itself on
  // that storey.
  //
  // `rounded` USED TO BE THE WORST OF THEM — it alone made `chamfer`, and the
  // all-rounded block was the one block in 66,920 that met nothing. At R = 2 it
  // stopped making the word at all, so the list is down to two plans, and the
  // survivors are handed pairs rather than a single isolating band.
  const table = wordsByPlan(planMask, PLAN_IDS, PLANS);
  const sole = new Map();
  for (const [bits, ids] of table) if (ids.size === 1 && WORDS.some((w) => w.bits === bits)) sole.set(bits, [...ids][0]);
  assert.deepEqual([...new Set(sole.values())].sort(), ['bar-wide', 'ell-deep']);
  assert.ok(!sole.has('011111110'), 'nothing makes chamfer any more');

  // AND THE PRICE HAS COLLAPSED, which is the second half of the finding and
  // was not predicted. At R = 2.5 a block showing `chamfer` reached 29 against
  // a baseline of 239 — EIGHT TIMES worse — and that gap was the mechanism of
  // isolation. What survives costs almost nothing:
  //
  //   with a sole-source word     mean reach 734,  worst  6
  //   without one                 mean reach 852,  worst  0.25
  //
  // 1.16×, and note which way the WORST case goes: a block carrying a
  // sole-source word now has a higher floor than one without. Whatever makes a
  // block hard to place at R = 2, it is no longer its rarest word.
  const group = (pred) => sheets.filter(pred);
  const showsSole = (s) => WALLS.some((side) => wordsOfWall(keyOf(profile(s.mask, side))).some((w) => sole.has(w)));
  const withIt = group(showsSole);
  const without = group((s) => !showsSole(s));
  const mean = (a) => a.reduce((n, s) => n + s.reach, 0) / a.length;
  const worst = (a) => a.reduce((n, s) => Math.min(n, s.reach), Infinity);
  assert.ok(withIt.length > 500, 'plenty of blocks are affected');
  assert.ok(mean(without) / mean(withIt) < 1.3,
    `the sole-source penalty is mild now: ${mean(without).toFixed(0)} vs ${mean(withIt).toFixed(0)}`);
  assert.ok(worst(withIt) > worst(without),
    `and it no longer sets the floor: ${worst(withIt)} vs ${worst(without)}`);
});

test('a wall reads back as words, and a solid block is solid all the way up', () => {
  const solid = sheets.find((s) => s.recipe === 'S:full,full,full:stone');
  assert.equal(describeWall(keyOf(profile(solid.mask, '+x'))), 'wall / wall / wall');

  // A bar between two solid storeys is the tunnel. `bar` is a strip running
  // along x, so the +x face shows it END ON: a pier in the middle with the two
  // side channels open either side of it. Those channels ARE the passage.
  const tunnel = sheets.find((s) => s.recipe === 'S:full,bar,full:stone');
  assert.equal(describeWall(keyOf(profile(tunnel.mask, '+x'))), 'wall / pier / wall');
  assert.equal(tunnel.through.x, true, 'and you can walk through, either side of the pier');
});

test('openings are found as rectangles, positioned and sized in yards', () => {
  const solid = '1'.repeat(SUB * SUB);
  assert.deepEqual(openings(solid), [], 'a solid wall has no openings');

  const empty = '0'.repeat(SUB * SUB);
  const all = openings(empty);
  assert.equal(all.length, 1);
  assert.equal(all[0].width, SUB);
  assert.equal(all[0].height, SUB);
  assert.equal(all[0].kind, 'slot', 'floor to ceiling, the full nine yards');

  // A door: the `door` word on the bottom storey, solid above. A wall is NINE
  // rows of nine, not three — a storey is three rows, because the plan is
  // extruded through all of them.
  const door = '111000111'.repeat(3) + '111111111'.repeat(6);
  assert.equal(door.length, SUB * SUB);
  const o = openings(door);
  assert.equal(o.length, 1);
  assert.equal(o[0].width, 3, 'three yards wide');
  assert.equal(o[0].height, 3, 'one storey tall');
  assert.equal(o[0].at, 3, 'centred');
  assert.equal(o[0].sill, 0, 'on the floor');
  assert.equal(o[0].kind, 'door');
});

test('the whole face and the three-yard doorway are most of every opening', () => {
  // THIS KEEPS CHANGING, and each change is the finding.
  //
  //   before the wall family   3 yd 46%,  9 yd 28%,  6 yd  2.8%
  //   after it                 9 yd 37%,  3 yd 35%,  6 yd 18.2%
  //   at R = 2                 9 yd 39%,  3 yd 26%,  6 yd 17.2%, and 4 yd 8.8%
  //
  // The wall family is made of archetypes that leave whole SIDES open, so the
  // fully open face overtook the doorway. R = 2 then widened the openings the
  // corner arcs leave: a round of 2 clears a whole sub-block at each end where
  // a round of 2.5 left a stub, so 4 and 5 yard openings appeared and took
  // their share out of the 3.
  const width = new Map();
  for (const side of WALLS) {
    for (const [key, set] of serve.get(side)) {
      for (const o of openings(key)) width.set(o.width, (width.get(o.width) || 0) + set.size);
    }
  }
  const ranked = [...width.entries()].sort((a, b) => b[1] - a[1]);
  assert.deepEqual([ranked[0][0], ranked[1][0]].sort((a, b) => a - b), [3, SUB],
    'the whole face and the 3 yd doorway lead, in some order');
  const total = [...width.values()].reduce((a, b) => a + b, 0);
  assert.ok((ranked[0][1] + ranked[1][1]) / total > 0.6,
    'and between them they are still most of every opening');
});
