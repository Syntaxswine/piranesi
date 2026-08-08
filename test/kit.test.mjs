// test/kit.test.mjs — the rules for choosing a hundred blocks out of ten
// thousand, and the two faults that made a kit look excellent and be broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { everyBlock } from '../js/enumerate.js';
import { measure, joinery, rank } from '../js/measure.js';
import { blockFromRecipe } from '../js/stack.js';
import { keyOf, profile } from '../js/measure.js';
import {
  featuresOf, matches, socketsOf, meets, componentsOf, pathToBody,
  pickKit, auditKit, repairConnectivity, repairVertical,
} from '../js/kit.js';

// One walk, shared: the grammar is 10,826 blocks and measuring it is the
// expensive part of every test below.
const sheets = everyBlock().recipes.map((r) => measure(r, blockFromRecipe(r))).filter(Boolean);
const serve = joinery(sheets);
rank(sheets);
for (const sh of sheets) sh.f = featuresOf(sh);
const byRecipe = new Map(sheets.map((s) => [s.recipe, s]));
const get = (r) => byRecipe.get(r);

/* ------------------------------------------------------------- features */

test('every block has a diversity key, arches included', () => {
  // THE SYMPTOM: a role asking for ten barrel vaults came back with one.  The
  // key was the plan sequence and an arch has no plans, so all 58 arches shared
  // the empty string and the kit could hold exactly one of them.  Nothing
  // errored; the kit was simply missing its vaults.
  for (const sh of sheets) {
    assert.ok(sh.f.seq, `${sh.recipe} must have a diversity key`);
    assert.ok(sh.f.set, `${sh.recipe} must have a coarse key`);
  }
  // The key deliberately DROPS TURNS — two turns of one idea are one idea, and
  // the stack key drops them too (`S:bar,bar,bar` and `S:bar/1,bar,bar` share a
  // key). So the 58 arches are 32 ideas, which is what a kit should choose
  // between. What must never happen is two different PIERS colliding.
  const arches = sheets.filter((s) => s.family === 'arch');
  const keys = new Set(arches.map((s) => s.f.seq));
  // 58 arches / 32 ideas before the wall family added six pier plans.
  assert.equal(keys.size, 48, '104 arches are 48 distinct ideas');
  assert.ok(keys.size > 12, 'and comfortably more than any arch quota will ask for');
  for (const a of arches) {
    for (const b of arches) {
      if (a.f.seq === b.f.seq) assert.equal(a.f.pier, b.f.pier, 'two piers must never share a key');
    }
  }
});

test('a filter that names no constraint accepts everything', () => {
  assert.equal(sheets.filter((s) => matches(s, {})).length, sheets.length);
  // 58 before the wall family; six new plans are six new pier choices.
  assert.equal(sheets.filter((s) => matches(s, { family: 'arch' })).length, 104);
});

/* -------------------------------------------------------------- joinery */

test('two blocks meet exactly when a wall of one answers a wall of the other', () => {
  const solid = get('S:full,full,full:stone');
  assert.ok(meets(solid, solid), 'two solid blocks stand side by side');

  // THE ONE DEAD END IN THE GRAMMAR IS GONE, and this is where it went.
  //
  // At R = 2.5 the all-rounded block met NOTHING but itself: its wall was a
  // curved band — `chamfer`, `011111110` — that only `rounded` made, and
  // `rounded` is four-fold symmetric, so there was exactly one such block and
  // nothing in 66,920 could stand beside it.
  //
  // At R = 2 the round bites less than a whole sub-block out of the corner, so
  // the wall reads as solid and `rounded` speaks `wall` like everything else.
  // The owner changed the radius for legibility; closing the only isolated
  // block in the grammar was a side effect nobody asked for.
  const wasLonely = get('S:rounded,rounded,rounded:stone');
  const answers = sheets.filter((s) => s !== wasLonely && meets(wasLonely, s));
  assert.ok(answers.length > 1000,
    `the all-rounded block used to meet nothing; it now meets ${answers.length}`);

  // …and NOTHING in the grammar is isolated any more. This is the claim that
  // matters — it is what "the cube law works" finally means without a footnote.
  //
  // Read off `reach`, which `joinery` has already indexed by wall pattern.
  // Asking `meets` for every pair is 66,920² and would take longer than the
  // rest of the suite put together for an answer already on the sheet.
  const lonely = sheets.filter((s) => s.reach === 0);
  assert.deepEqual(lonely.map((s) => s.recipe), [], 'no block may meet nothing');
});

test('sockets cover all four turns, so a block may be rotated to fit', () => {
  const sh = get('S:ell,bar/1,frame:stone');
  const { set, own } = socketsOf(sh);
  assert.equal(own.length, 4, 'four walls at rest');
  assert.ok(set.size >= own.length, 'and more once it may turn');
  for (const k of own) assert.ok(set.has(k), 'a wall at rest is a wall it can present');
});

/* --------------------------------------------------------- connectivity */

test('a stranded island is found, and joined by the shortest chain', () => {
  // THE SYMPTOM, and it is the one worth remembering: a kit of 100 came back
  // with 99 of 100 blocks flush on all four walls — and it was TWO KITS.  An
  // 87-block body and a 13-block island of arches with no way between them.
  //
  // The greedy pass cannot see this.  It rewards a block for answering walls
  // nothing else answers, but the arches went in consecutively and ANSWER EACH
  // OTHER, so no arch wall was ever unanswered and nothing was ever drawn
  // toward them.  Connectivity is global; a local objective is blind to it.
  const arches = sheets.filter((s) => s.family === 'arch').slice(0, 6);
  const walls = sheets.filter((s) => s.family === 'stack' && s.mass > 0.9).slice(0, 6);
  const split = [...arches, ...walls];
  const c = componentsOf(split);
  assert.ok(c.count > 1, 'arches and solid walls do not meet each other directly');

  // And there is no ONE block that bridges them — measured, not assumed.
  const direct = sheets.filter((s) => !split.includes(s)
    && arches.some((a) => meets(s, a)) && walls.some((w) => meets(s, w)));
  const path = pathToBody(arches, walls, sheets, serve, 4);
  if (!direct.length) {
    assert.ok(path.ok, 'no single bridge exists, so a multi-hop chain must be found');
    assert.ok(path.hops >= 2, 'and it must be more than one hop');
  }
  assert.ok(path.ok, 'the arches must be reachable from the walls somehow');
});

/* ------------------------------------------------------------- the pick */

test('a kit is diverse, connected, and contains what it was told to', () => {
  const spec = {
    roles: [
      { name: 'solid', count: 4, filter: { family: 'stack', massMin: 0.9, waysMax: 0 } },
      { name: 'vault', count: 6, filter: { family: 'arch' } },
      { name: 'passage', count: 8, filter: { family: 'stack', horizontalPassage: true } },
      { name: 'free', count: 12, filter: {} },
    ],
  };
  const pin = ['S:full,full,full:stone'];
  const { kit, short } = pickKit(sheets, spec, { size: 30, pin });
  repairConnectivity(kit, sheets, { pin, serve });
  const audit = auditKit(kit);

  assert.equal(kit.length, 30, 'the kit is the size asked for');
  assert.ok(kit.some((s) => s.recipe === pin[0]), 'the pinned solid block is in');
  assert.equal(short.length, 0, `no role should run short: ${JSON.stringify(short)}`);

  // A role asking for six arches must get six — the regression that the empty
  // diversity key caused.
  assert.ok(kit.filter((s) => s.family === 'arch').length >= 6, 'the vault role is filled');

  // Diversity: no two blocks are the same three plans in the same order.
  const seqs = kit.map((s) => s.f.seq);
  assert.equal(new Set(seqs).size, seqs.length, 'no two blocks are the same idea');

  // AND IT MUST BE ONE THING.
  assert.equal(audit.components.count, 1,
    `a kit in ${audit.components.count} pieces builds ${audit.components.count} buildings`);
  assert.equal(audit.orphans.length, 0, 'no block may meet nothing else in the kit');
});

test('the audit reports kit-local joinery, not whole-grammar joinery', () => {
  // `reach` across 10,826 blocks says almost nothing about a kit of thirty.
  // Conflating the two would let a kit of mutual strangers score perfectly.
  const spec = { roles: [{ name: 'free', count: 20, filter: {} }] };
  const { kit } = pickKit(sheets, spec, { size: 20 });
  auditKit(kit);
  for (const s of kit) {
    assert.ok(s.kitFlush <= 4 && s.kitFlush >= 0);
    assert.ok(s.kitFlush <= s.flush, 'a kit of 20 cannot answer more walls than the whole grammar');
    assert.ok(s.flush !== undefined && s.reach !== undefined, 'whole-grammar numbers survive the audit');
  }
});

test('every block in a kit has something in the kit it can be set down on', () => {
  // THE SYMPTOM: a building with no third storey.  Deck joinery is far stricter
  // than wall joinery — B stands on A only if B's whole floor equals A's whole
  // ceiling — and a hundred blocks chosen for their WALLS left 17 of them with
  // nothing to stand on, and five base plans in use with no matching top plan
  // anywhere in the set.  Whether a block can be set down is a fact about the
  // other ninety-nine, so no per-block filter can fix it.
  const spec = { roles: [{ name: 'free', count: 40, filter: { chambersMax: 0 } }] };
  const pin = ['S:full,full,full:stone'];
  const { kit } = pickKit(sheets, spec, { size: 40, pin });
  repairConnectivity(kit, sheets, { pin, serve, spec });
  repairVertical(kit, sheets, { pin, spec });

  const floor = (s) => keyOf(profile(s.mask, '-z'));
  const carries = (a, b) => socketsOf(a).set.has(`+z|${floor(b)}`);
  const orphans = kit.filter((s) => !kit.some((a) => a !== s && carries(a, s)));
  assert.equal(orphans.length, 0,
    `nothing can be set down on: ${orphans.map((s) => s.recipe).join(', ')}`);

  // AND THE LIFT MUST NOT COST THE CONNECTIVITY.  Chosen for its ceiling alone,
  // a lift block joins vertically and nothing horizontally — it becomes its own
  // island, and the kit goes back to two components having just been made one.
  assert.equal(componentsOf(kit).count, 1, 'the vertical repair must not strand anything');
  for (const s of kit) {
    assert.ok(kit.some((m) => m !== s && meets(m, s)), `${s.recipe} must meet the kit on a wall`);
  }
});

test('a role with no candidates is reported, never quietly topped up', () => {
  // A role coming up empty is a gap in the GRAMMAR, and silently filling the
  // slot with something else turns that into a kit that merely looks complete.
  const spec = {
    roles: [
      { name: 'impossible', count: 5, filter: { massMin: 0.999, waysMin: 3 } },
      { name: 'free', count: 5, filter: {} },
    ],
  };
  const { kit, short } = pickKit(sheets, spec, { size: 10 });
  assert.equal(short.length, 1, 'the impossible role must be reported');
  assert.equal(short[0].role, 'impossible');
  assert.equal(short[0].got, 0);
  assert.equal(kit.length, 10, 'and the kit is still the size asked for');
});
