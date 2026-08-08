// test/drawn.test.mjs — THE DRAWING BOARD, and the four ways a hand-drawn block
// could quietly not be a block.
//
// The heavy one is the first: a drawn shape and the named plan it copies must be
// the SAME BLOCK, not two blocks that look alike. Everything else in the family
// rests on that, because it is what says the board is drawing in the game's own
// units rather than in units that resemble them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SUB, PLANES, DECKS, R } from '../js/cube.js';
import { PLANS, PLAN_IDS, planIsLegal, columnAt, coveAt } from '../js/plan.js';
import { LAYERS as RECIPE_LAYERS, decode, label } from '../js/recipe.js';
import { blockFromRecipe } from '../js/stack.js';
import { maskFor, solidityMask } from '../js/solidity.js';
import { Mesh } from '../js/mesh.js';
import {
  SLICES, N, LAYERS, RISE, DIRS, HY, UNHY, idx, cellBox, CORNER_CELLS,
  blank, cellsToRects, rectsInYards, cellsFromRects,
  encodeDrawn, decodeDrawn, drawnMesh, rampWedge, planeIndex,
  drawnPlanBody, planOfLayer, boardFormOfPlan, turnForm, formKey,
} from '../js/drawn.js';

const S = SUB;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ------------------------------------------------------------- the board -- */

test('the board IS the slice planes, and it regenerates from them', () => {
  // Not "a grid that happens to agree with the planes" — the same array. When
  // the ladder is simplified (handoff §6.1: R = 2, 2.5 and 6.5 dropped) the
  // board gets coarser on its own and every drawing keeps its yards, because a
  // recipe stores yards and never cell indices.
  assert.equal(SLICES, PLANES);
  assert.equal(N, PLANES.length - 1);
  assert.equal(LAYERS, RECIPE_LAYERS, 'a drawn block has the same three storeys a stacked one has');
  assert.equal(RISE, DECKS[1] - DECKS[0]);
});

test('every slice plane is one character, which is what the codec assumes', () => {
  // The recipe is in HALF-YARDS, base 36, so a coordinate is one character and
  // a rectangle is four. That holds while every plane is a whole number of half
  // yards and the block is under 18 yards. Both are facts about the cube law,
  // and if either stops being true this is where it must fail.
  for (const p of PLANES) {
    const c = HY(p);
    assert.equal(c.length, 1, `${p} yards must encode as one character`);
    assert.equal(UNHY(c), p, `${p} must survive the round trip`);
  }
  assert.equal(HY(0), '0');
  assert.equal(HY(S), 'i', 'nine yards is eighteen half-yards is i');
});

/* ----------------------------------------------------- the partition law -- */

test('painted cells become a PARTITION — every cell covered exactly once', () => {
  // §2.3 of the handoff, and the reason the board can never draw the bug: two
  // overlapping polygons are crossed twice by the solidity ray and the overlap
  // reads as VOID. A partition has no overlap to read.
  const shapes = [
    (i, j) => (i + j) % 3 !== 0,                         // a scatter
    (i, j) => i < 3 || j > 5,                            // an L
    (i, j) => i > 0 && i < N - 1 && j > 0 && j < N - 1,   // a court
    () => true,                                          // solid
    (i, j) => (i * 7 + j * 13) % 5 < 2,                  // noise
  ];
  for (const f of shapes) {
    const cells = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (f(i, j)) cells[idx(i, j)] = 1;
    const cover = new Uint8Array(N * N);
    for (const [i0, j0, i1, j1] of cellsToRects(cells)) {
      assert.ok(i1 > i0 && j1 > j0, 'a piece with no area is not a piece');
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          assert.equal(cover[idx(i, j)], 0, `cell ${i},${j} is covered twice`);
          cover[idx(i, j)] = 1;
        }
      }
    }
    assert.ok(same(cover, cells), 'the partition covers the painted cells and nothing else');
  }
});

test('a partition of the board is a legal plan by construction', () => {
  const cells = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if ((i * 3 + j) % 4) cells[idx(i, j)] = 1;
  const polys = rectsInYards(cells).map(([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  const v = planIsLegal(polys);
  assert.ok(v.ok, `every vertex must be on a slice plane; ${JSON.stringify(v.at)} was not`);
});

test('cells survive the round trip through yards', () => {
  const cells = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) cells[k] = (k * 5 + 1) % 7 < 3 ? 1 : 0;
  assert.ok(same(cellsFromRects(rectsInYards(cells)), cells));
});

/* ------------------------------------------------- drawn == named, exactly */

/**
 * THE BOARD CAN DRAW EVERY PLAN IN THE VOCABULARY.
 *
 * It was seven plans short until R came down to 2. At 2.5 a corner arc crossed
 * its edges at 2.5, between the planes at 2 and 3, so a round was a property of
 * the whole block and there was no way to ask for one corner of it. At 2 it
 * crosses at 2 and 7, the corner cell is exactly R by R, and a round becomes a
 * property of ONE CELL. That is the whole of why the circles work now.
 *
 * The table of WHICH token each curved plan needs used to live here, in the
 * test, which was the wrong place for it: it is the answer to "what is this
 * plan in the board's own terms", and only the test knew. It is `drawn.js
 * CURVED` now, `boardFormOfPlan` builds on it, `planOfLayer` reads it — and this
 * test, which compares solidity masks and has no exclusions, is what keeps it
 * honest.
 */
test('a drawn plan and the named plan it copies are the SAME BLOCK', () => {
  // THE ONE THAT MATTERS. Draw each plan on the slice grid, stack three of it,
  // and the solidity mask must be identical to `S:<plan>,<plan>,<plan>`. Same
  // lattice, same stone.
  //
  // No exclusions. A plan that fails here has a coordinate the board cannot
  // express, which would be a finding about the VOCABULARY, not about the test.
  for (const id of PLAN_IDS) {
    const layer = drawnPlanBody(id);
    assert.ok(layer, `${id}: the board must be able to draw it at all`);
    const drawn = `D:${layer},${layer},${layer}:stone`;
    const named = `S:${id},${id},${id}:stone`;

    const d = decode(drawn);
    assert.ok(d.ok, `${id}: ${drawn} — ${d.why}`);
    const a = blockFromRecipe(named);
    const b = blockFromRecipe(drawn);
    assert.ok(b, `${drawn} must build (${id})`);
    assert.ok(same(maskFor(a), maskFor(b)),
      `${id}: the drawn block is a different block from the named one`);
  }
});

test('…AND IT IDENTIFIES BACK, in every turn — BACKLOG 0r', () => {
  // The other direction, and the one `kit.js` needs: given a hand-drawn storey,
  // which plan is it? Without an answer a drawn block has no `plans`, matches
  // almost no role, and — worse — every drawn block shares the empty diversity
  // key, so a kit can hold exactly one of them. That is the arch bug of
  // `featuresOf` happening a second time to a second family.
  //
  // Rasterising the plan and then asking is not circular: the two go through
  // different code — `boardFormOfPlan` rasterises polygons, `planOfLayer` reads
  // a decoded recipe — and the recipe has been through the encoder, the parser
  // and the overlap rules in between.
  for (const id of PLAN_IDS) {
    for (let q = 0; q < 4; q++) {
      const body = drawnPlanBody(id, q);
      assert.ok(body, `${id} q${q}: the board must be able to draw it turned too`);
      const d = decodeDrawn(`D:${body},${body},${body}:stone`);
      assert.ok(d.ok, `${id} q${q}: ${body} — ${d.why}`);
      const got = planOfLayer(d.layers[0]);
      assert.ok(got, `${id} q${q}: drawn as ${body} and identified as nothing`);
      assert.equal(got.id, id, `${id} q${q}: drawn as ${body} and identified as ${got.id}`);
    }
  }
});

test('a storey that is not in the vocabulary says NOTHING, not the nearest thing', () => {
  // The whole value of the answer is that it can be trusted. A `usesPlans`
  // filter that matched approximately would be the substitution this project
  // refuses everywhere else.
  const notPlans = [
    '0069',              // 3 x 4.5 out of a corner — no plan is that
    '0044eeii',          // two opposite corner cells, square not round
    '60ii!006in',        // the cells of `full`, but a ramp climbs through it
  ];
  for (const body of notPlans) {
    const d = decodeDrawn(`D:${body},-,-:stone`, { allowEmpty: true });
    assert.ok(d.ok, `${body}: ${d.why}`);
    assert.equal(planOfLayer(d.layers[0]), null, `${body} was matched to a plan it is not`);
  }
  // …while the ramp's own storey being unnameable does not stop the storey
  // above it being named.
  const stair = decodeDrawn('D:00ii,004i!609in,6eii:stone');
  assert.equal(planOfLayer(stair.layers[0]).id, 'full');
  assert.equal(planOfLayer(stair.layers[1]), null);
});

test('a drum survives being read back and written out again', () => {
  // `parseLayer` SETS the drum's cells — that is how it refuses masonry standing
  // where the drum stands — and the board CLEARS them when you pick a drum. The
  // two conventions differ by exactly those nine cells, and `encodeLayer` used
  // to emit them as rectangles beside the `*d`: a recipe that will not decode,
  // produced from a recipe that did.
  const rec = 'D:*d,00ii,-:stone';
  const d = decodeDrawn(rec);
  assert.ok(d.ok, d.why);
  const again = encodeDrawn({ mat: d.mat, layers: d.layers });
  assert.equal(again, rec, 'a decoded layer must encode back to itself');
  assert.ok(decodeDrawn(again).ok);
});

test('the corner cell is exactly R by R, which is why a round is one cell', () => {
  // The claim the whole curve feature rests on, checked against the geometry
  // rather than asserted in a comment. If R and the ladder ever disagree again,
  // this is the line that says so.
  for (const [i, j] of CORNER_CELLS) {
    const [x0, y0, x1, y1] = cellBox(i, j);
    assert.equal(x1 - x0, R, `corner cell ${i},${j} is ${x1 - x0} wide, not R`);
    assert.equal(y1 - y0, R, `corner cell ${i},${j} is ${y1 - y0} deep, not R`);
  }
  // …and both curves live wholly inside it.
  for (let k = 0; k < 4; k++) {
    for (const poly of [columnAt(k), coveAt(k)]) {
      const [ci, cj] = CORNER_CELLS[k];
      const [x0, y0, x1, y1] = cellBox(ci, cj);
      for (const [x, y] of poly) {
        assert.ok(x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - 1e-9 && y <= y1 + 1e-9,
          `corner ${k}: a point at ${x},${y} is outside its cell ${x0},${y0},${x1},${y1}`);
      }
    }
  }
});

test('a column and a cove are the two ways a quarter-circle sits in a square', () => {
  // They are NOT complements — each covers a quarter-disc of the R² cell — and
  // knowing that is what stops someone "simplifying" one into the other.
  for (let k = 0; k < 4; k++) {
    const area = (poly) => Math.abs(poly.reduce((s, [x, y], i) => {
      const [px2, py2] = poly[(i + 1) % poly.length];
      return s + (x * py2 - px2 * y);
    }, 0)) / 2;
    const quarter = Math.PI * R * R / 4;
    // The tessellation is what gets built, so it comes in a little under the
    // true quarter-disc; 4% at ten steps.
    for (const poly of [columnAt(k), coveAt(k)]) {
      assert.ok(Math.abs(area(poly) - quarter) < quarter * 0.05,
        `corner ${k}: ${area(poly).toFixed(3)} against a quarter-disc of ${quarter.toFixed(3)}`);
    }
  }
});

const encRect = ([x0, y0, x1, y1]) => HY(x0) + HY(y0) + HY(x1) + HY(y1);

/** A plan's polygons, sampled at the centre of every board cell. Even-odd, the
 *  same rule the solidity ray uses, so a plan cut into disjoint pieces reads the
 *  way the mesh will read it. */
function rasterise(polys) {
  const cells = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (SLICES[i] + SLICES[i + 1]) / 2, y = (SLICES[j] + SLICES[j + 1]) / 2;
      let inside = false;
      for (const p of polys) {
        for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
          const [ax, ay] = p[a], [bx, by] = p[b];
          if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        }
      }
      if (inside) cells[idx(i, j)] = 1;
    }
  }
  return cells;
}

/* ---------------------------------------------------------------- recipes */

test('a drawing round-trips through its recipe', () => {
  const d = blank('rustic');
  d.layers[0].cells = cellsFromRects([[0, 0, 9, 3], [0, 6, 9, 9]]);
  d.layers[1].cells = cellsFromRects([[0, 0, 2, 9]]);
  d.layers[1].ramps.push({ x0: 2, y0: 0, x1: 9, y1: 3, dir: 'e' });
  d.layers[2].cells = cellsFromRects([[3, 3, 6, 6]]);

  const rec = encodeDrawn(d);
  const back = decodeDrawn(rec);
  assert.ok(back.ok, back.why);
  assert.equal(encodeDrawn({ mat: back.mat, layers: back.layers }), rec, 'encode∘decode is the identity');
  assert.equal(back.mat, 'rustic');
  assert.equal(back.layers[1].ramps[0].dir, 'e');
  assert.ok(same(cellsFromRects(back.layers[0].rects), d.layers[0].cells));
});

test('the grammar refuses every drawing that would build a broken block', () => {
  const cases = [
    ['D:00ii,00ii:stone', /needs 3 layers/],
    ['D:00ii00ii,-,-:stone', /overlaps/],          // §2.3 — the overlap reads as void
    ['D:0011,-,-:stone', /off the slice planes/],
    ['D:ii00,-,-:stone', /no area/],
    ['D:-,-,-:stone', /no stone in it/],           // else `maskFor` falls back to SOLID
    ['D:00ii,!0046e,-:stone', /needs 3 of floorspace/],
    ['D:00ii,!00i6q,-:stone', /no such ramp direction/],
    ['D:00ii,!00i6,-:stone', /whole number of ramps/],
    ['D:00i,-,-:stone', /whole number of rectangles/],
    ['D:00ii,-,-:marble', /no such material/],
    ['D:00ii!00i6e,-,-:stone', /overlaps/],        // a ramp standing in the fill
    // The curves obey the same one rule: one occupant per cell.
    ['D:0044~o...,-,-:stone', /overlaps/],         // a rectangle under a corner round
    ['D:~ooo,-,-:stone', /four characters/],
    ['D:~oooo.,-,-:stone', /four characters/],
    ['D:~ooz.,-,-:stone', /no such corner/],
    ['D:*z,-,-:stone', /no such disc/],
    ['D:00ii*s,-,-:stone', /whole storey/],        // a bore takes no paint
    ['D:00ii*d,-,-:stone', /masonry in the way/],  // a drum standing in a solid floor
  ];
  for (const [rec, why] of cases) {
    const d = decode(rec);
    assert.equal(d.ok, false, `${rec} must be refused`);
    assert.match(d.why, why, `${rec}: ${d.why}`);
  }
  // …and a blank board is a legal thing to be LOOKING at.
  assert.equal(decodeDrawn('D:-,-,-:stone', { allowEmpty: true }).ok, true);
});

test('a drawn block joins the grammar without disturbing it', () => {
  const rec = 'D:00ii,0cii,0cii:stone';
  const d = decode(rec);
  assert.equal(d.family, 'drawn');
  assert.match(label(rec), /^drawn /);
  const def = blockFromRecipe(rec);
  assert.equal(def.family, 'drawn');
  assert.deepEqual(def.size, [S, S, S]);
  assert.equal(def.id, rec, 'the recipe IS the identity');
  // The other two families still answer for themselves.
  assert.equal(decode('S:full,full,full:stone').family, 'stack');
  assert.equal(decode('A:y+:twin:stone').family, 'arch');
});

/* ------------------------------------------------------------- the ramp -- */

test('every face of a ramp points OUT of it, in all four directions', () => {
  // A face wound backwards is invisible from outside and solid-looking from
  // within, which is about the least legible bug there is — so the wedge is
  // written once in its own frame and the four directions are four right-handed
  // placements of that frame. This is what says the placements really are.
  for (const dir of DIRS) {
    const m = new Mesh();
    rampWedge(m, { x0: 0, y0: 0, x1: 9, y1: 3, dir }, 0, 'stone', 't');
    m.finish();
    assert.equal(m.faces.length, 5, 'a wedge is five faces');
    const c = [0, 1, 2].map((k) => m.verts.reduce((a, p) => a + p[k], 0) / m.verts.length);
    for (const f of m.faces) {
      const out = (f.c[0] - c[0]) * f.n[0] + (f.c[1] - c[1]) * f.n[1] + (f.c[2] - c[2]) * f.n[2];
      assert.ok(out > 0, `${dir}: a face points inward (${f.n.map((v) => v.toFixed(2))})`);
      assert.ok(f.area > 1e-6, `${dir}: a face with no area`);
    }
  }
});

test('a ramp actually climbs a storey, measured in the lattice', () => {
  // Not "the mesh has a sloping face" — the SOLIDITY MASK, which is what the
  // light marches and what says whether there is stone under your feet.
  for (const [dir, toe, head] of [['e', 0, 8], ['w', 8, 0]]) {
    const rec = `D:-,!00i6${dir},-:stone`;
    const def = blockFromRecipe(rec);
    assert.ok(def, rec);
    const m = maskFor(def);
    const at = (x, y, z) => m[x + S * (y + S * z)];
    assert.equal(at(toe, 1, DECKS[1] + 2), 0, `${dir}: the toe of the ramp is not a wall`);
    assert.equal(at(head, 1, DECKS[1] + 2), 1, `${dir}: the head reaches the next storey`);
    assert.equal(at(head, 1, DECKS[1]), 1, `${dir}: and it is solid all the way down`);
  }
});

test('a ramp climbs exactly one storey and no more', () => {
  const m = new Mesh();
  rampWedge(m, { x0: 0, y0: 0, x1: 9, y1: 9, dir: 'n' }, DECKS[1], 'stone', 't');
  m.finish();
  const zs = m.verts.map((p) => p[2]);
  assert.equal(Math.min(...zs), DECKS[1]);
  assert.equal(Math.max(...zs), DECKS[2], 'the head lands on the next deck, not between decks');
});

test('the steepest ramp the game allows is 45 degrees', () => {
  // His rule — "each layer up is 3 yards, so it requires at least 3 yards of
  // floorspace" — read back out of the grammar rather than out of a comment.
  const run = (r) => decode(`D:-,!${r},-:stone`);
  assert.equal(run('0066e').ok, true, 'three yards of run is legal, and it is 45°');
  assert.equal(Math.round(Math.atan2(RISE, 3) * 180 / Math.PI), 45);
  assert.equal(run('0046e').ok, false, 'two is not');
});

test('a ramp is stone even where the layer is otherwise empty', () => {
  const def = blockFromRecipe('D:-,-,!00i6n:stone');
  assert.ok(def, 'a block that is nothing but a ramp on the top storey');
  const m = maskFor(def);
  assert.ok(m.reduce((a, v) => a + v, 0) > 0, 'and it has some stone in it');
  // The fallback in `maskFor` turns an EMPTY mask into a fully solid block, so
  // "some stone" here also proves the mask is real rather than the fallback.
  assert.ok(m.reduce((a, v) => a + v, 0) < S * S * S, 'but it is not solid');
});

/* ------------------------------------------------------ the whole drawing */

test('a drawn block is a CLOSED mesh, ramps and all', () => {
  // Parity is what decides where the stone is, and parity is only meaningful on
  // a closed surface: one missing face and half the block goes hollow with
  // nothing to say so. Every edge shared by exactly two faces is the statement
  // of that, and it is the check that would catch a wedge losing a flank.
  const rec = 'D:00ii,0c6i!00c6e,66cc:stone';
  const a = blockFromRecipe(rec), b = blockFromRecipe(rec);
  assert.ok(a && b, decode(rec).why);
  assert.equal(a.mesh.faces.length, b.mesh.faces.length);
  assert.ok(same(maskFor(a), maskFor(b)), 'the same recipe is the same block');

  for (const e of a.mesh.edges) {
    assert.equal(e.f.length, 2, `edge ${e.a}-${e.b} is on ${e.f.length} faces, so the mesh is open`);
  }

  // And the mask is a real measurement rather than `maskFor`'s solid fallback:
  // this block has a court in it and a storey that is mostly air.
  const n = solidityMask(a.mesh, [S, S, S]).reduce((t, v) => t + v, 0);
  assert.ok(n > 0 && n < S * S * S, `${n} solid cells of ${S ** 3} — neither empty nor the fallback`);
});

test('planeIndex refuses a coordinate that is nearly on a plane', () => {
  assert.equal(planeIndex(4.5), PLANES.indexOf(4.5));
  assert.equal(planeIndex(4.51), -1, 'nearly on the grid is off the grid');
  assert.equal(planeIndex(1), -1);
});

test('a drawing carries no state a recipe cannot express', () => {
  // The board's whole document is one string. Anything it kept on the side
  // would be lost the moment a block went into a building, which is the bug
  // recipe.js exists to kill — restated for the third family.
  const d = blank('stone');
  d.layers[0].cells = cellsFromRects([[2, 2, 7, 7]]);
  d.layers[2].ramps.push({ x0: 0, y0: 0, x1: 9, y1: 4.5, dir: 'e' });
  const one = encodeDrawn(d);
  const back = decodeDrawn(one);
  const two = encodeDrawn({
    mat: back.mat,
    layers: back.layers.map((l) => ({ cells: cellsFromRects(l.rects), ramps: l.ramps })),
  });
  assert.equal(two, one);
});
