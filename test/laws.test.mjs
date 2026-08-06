// test/laws.test.mjs — the rules that were expensive to learn.
//
// Each of these pins a fault that actually happened and cost a plate to find.
// A test here should name the symptom, not just the invariant, so that whoever
// breaks it knows what the picture will look like when they do.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Camera, DEG, projectWith } from '../js/math.js';
import { buildCatalog, METRES_PER_CELL } from '../js/blocks.js';
import { World, STRUCTURE, FITTING } from '../js/world.js';
import { Engraver } from '../js/engrave.js';
import { Plate } from '../js/ink.js';
import { buildScene, scenes, catalogFor } from '../js/scenes.js';
import { buildModules, stampCompound, MODULE } from '../js/modules.js';
import { bandTone, bandLine, stoneRange } from '../js/palette.js';
import { stoneAt } from '../js/stone.js';
import { buildCatalog as buildCatalog2 } from '../js/compose.js';
import { bandFor, buildCamera, LAYER } from '../js/build.js';
import {
  SUB, SUB_YARDS, SUB_FEET, BLOCK_YARDS, BLOCK_FEET, BLOCK_METRES,
  METRES_PER_SUB, R, R_WHOLE, onPlane,
} from '../js/cube.js';
import { FORMS } from '../js/forms.js';
import { SAMPLE_OFFSETS } from '../js/solidity.js';
import { buildCatalog as buildStack } from '../js/stack.js';
import { survey, KIND_IDS } from '../js/anchors.js';

const catalog = buildCatalog();

/* ------------------------------------------------------------- projection */

test('the camera cannot pitch: vertical world lines stay vertical on the plate', () => {
  // If this fails the drawing stops being an architectural plate and becomes a
  // photograph of a video game.  math.js explains why at length.
  const cam = new Camera({ eye: [3, -7, 1.6], yaw: 0.6, shift: 300 });
  cam.setFraming({ width: 800, height: 1000, hfovDeg: 80 });
  const c = cam.snapshot();
  for (const [x, y] of [[4, 2], [-6, 11], [0.5, 30], [12, -1]]) {
    const a = projectWith(c, x, y, -3);
    const b = projectWith(c, x, y, 19);
    assert.ok(a[2] > 0 && b[2] > 0, 'test point must be in front of the camera');
    assert.ok(Math.abs(a[0] - b[0]) < 1e-9,
      `a vertical at (${x},${y}) projected to x=${a[0]} and x=${b[0]} — the camera is converging verticals`);
  }
});

test('shift moves the frame without changing any world direction', () => {
  const mk = (shift) => {
    const cam = new Camera({ eye: [0, -6, 2], yaw: 90 * DEG, shift });
    cam.setFraming({ width: 600, height: 800, hfovDeg: 70 });
    return cam.snapshot();
  };
  const a = projectWith(mk(0), 2, 4, 3);
  const b = projectWith(mk(250), 2, 4, 3);
  assert.equal(a[0], b[0], 'shift must not move anything horizontally');
  assert.ok(Math.abs((b[1] - a[1]) - 250) < 1e-9, 'shift must translate the frame exactly');
});

/* ------------------------------------------------------------------ ink */

test('ink is transmittance, so crossing two hatch layers is darker than one', () => {
  // The whole reason ink.js multiplies instead of adding.  If this ever fails,
  // cross-hatching has stopped doing anything and every dark register is a lie.
  const one = new Plate(60, 60, 1);
  const two = new Plate(60, 60, 1);
  for (let i = 0; i < 60; i += 4) {
    one.segment(0, i, 59, i, 0.5);
    two.segment(0, i, 59, i, 0.5);
    two.segment(i, 0, i, 59, 0.5);
  }
  assert.ok(two.meanInk() > one.meanInk() * 1.5,
    `crossed ${two.meanInk().toFixed(3)} vs single ${one.meanInk().toFixed(3)}`);
  assert.ok(two.meanInk() < 1, 'ink must saturate toward black, never clip past it');
});

/* ---------------------------------------------------------------- lattice */

test('a fitting and a structure share a cell; two structures do not', () => {
  // The bug this pins: a railing placed on a stair DELETED the stair, and the
  // plate came back with handrails floating in mid-air over nothing.
  const w = new World(catalog);
  w.place(0, 0, 0, 'stair');
  w.place(0, 0, 0, 'stair-railing');
  assert.equal(w.at(0, 0, 0).id, 'stair', 'the fitting displaced its own structure');
  assert.equal(w.fittingAt(0, 0, 0).id, 'stair-railing');
  assert.equal(catalog.get('stair-railing').layer, FITTING);
  assert.equal(catalog.get('stair').layer, STRUCTURE);

  w.place(0, 0, 0, 'pier');
  assert.equal(w.at(0, 0, 0).id, 'pier', 'a structure must displace a structure');
  assert.ok(w.fittingAt(0, 0, 0), 'and must leave the fitting alone');
});

test('a multi-cell block occupies every cell it covers, and any of them removes it', () => {
  const w = new World(catalog);
  w.place(2, 3, 1, 'arch-4');                    // 4 x 1 x 3
  assert.equal(w.blocks.size, 1);
  assert.equal(w.cellCount, 12);
  assert.ok(w.at(5, 3, 3), 'the far top corner must be occupied');
  w.remove(5, 3, 3);
  assert.equal(w.blocks.size, 0, 'clicking any cell of a block must take the whole block');
  assert.equal(w.cellCount, 0, 'and must leave no orphaned occupancy behind');
});

test('a turned block occupies a turned footprint', () => {
  const w = new World(catalog);
  w.place(0, 0, 0, 'arch-4', 1);                 // 4 x 1 x 3 turned -> 1 x 4 x 3
  assert.ok(w.at(0, 3, 0), 'the block must extend along +y once turned');
  assert.equal(w.at(3, 0, 0), null, 'and must not extend along +x');
});

test('a save round-trips to an identical building', () => {
  const a = buildScene('bay', catalog);
  const b = World.fromJSON(catalog, JSON.parse(JSON.stringify(a.toJSON())));
  assert.deepEqual(b.toJSON(), a.toJSON());
  assert.equal(b.blocks.size, a.blocks.size);
});

/* --------------------------------------------------------------- geometry */

test('the joinery law: an arch spans an even number of cells and rises half its span', () => {
  // Break this and an arch crowns half a cell up, and every course a player
  // stacks above it is off-lattice forever.
  for (const id of ['arch-2', 'arch-4', 'vault-2', 'vault-4']) {
    const d = catalog.get(id);
    const span = d.size[0];
    assert.equal(span % 2, 0, `${id} spans ${span} cells — arches must span an even number`);
    assert.ok(d.size[2] > span / 2,
      `${id} is ${d.size[2]} cells tall but rises ${span / 2} — it needs material above its crown`);
  }
});

test('every block in the catalogue builds a closed, framed mesh', () => {
  for (const def of catalog.values()) {
    const m = def.mesh;
    assert.ok(m.faces.length > 0, `${def.id} has no faces`);
    for (const f of m.faces) {
      assert.ok(Number.isFinite(f.n[0] + f.n[1] + f.n[2]), `${def.id}/${f.tag} has a degenerate normal`);
      assert.ok(Math.abs(Math.hypot(...f.n) - 1) < 1e-6, `${def.id}/${f.tag} normal is not unit`);
      assert.ok(Number.isFinite(f.hatchDir[0]), `${def.id}/${f.tag} has no hatch direction`);
      // The frame must actually lie in the face's plane, or the hatching will
      // walk off the surface it is supposed to be describing.
      const d = f.uAxis[0] * f.n[0] + f.uAxis[1] * f.n[1] + f.uAxis[2] * f.n[2];
      assert.ok(Math.abs(d) < 1e-6, `${def.id}/${f.tag} u-axis is not in the plane`);
    }
  }
});

test('the module is 2 m and a man is under one cell', () => {
  assert.equal(METRES_PER_CELL, 2.0);
  assert.ok(1.75 / METRES_PER_CELL < 1, 'a man must fit under a one-cell opening');
});

/* --------------------------------------------------------------- rendering */

test('coincident faces cancel, so a run of bays becomes a tunnel', () => {
  // Not an optimisation.  If these stop cancelling, every bay keeps the
  // membrane between it and the next and the tunnel becomes a stack of hoops.
  const w = new World(catalog);
  for (let y = 0; y < 6; y++) w.place(0, y, 0, 'vault-2');
  const eng = new Engraver({ width: 200, height: 200, ss: 1 });
  const cam = new Camera({ eye: [1, -4, 0.6], yaw: 90 * DEG, shift: 40 });
  const r = eng.render(w, cam, catalog, { hatching: false, coursing: false });
  assert.ok(r.cancelled >= 20, `only ${r.cancelled} faces cancelled across six bays`);
});

test('a face buried behind a wall costs nothing', () => {
  const w = new World(catalog);
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.place(x, 0, z, 'ashlar');
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.place(x, 4, z, 'ashlar');
  const eng = new Engraver({ width: 220, height: 220, ss: 1 });
  const cam = new Camera({ eye: [0.5, -3, 0.5], yaw: 90 * DEG, shift: 0 });
  const r = eng.render(w, cam, catalog, {});
  assert.ok(r.visible < r.faces,
    'the far wall is hidden behind the near one and must not be hatched');
});

test('the plate is deterministic — the same building draws the same bytes', () => {
  // Every wobble in this renderer is a hash of the stroke's identity.  If one
  // of them ever reaches for Math.random the plate boils as you move.
  const w = buildScene('bay', catalog);
  const cam = () => {
    const c = new Camera({ eye: [1.5, -6, 1.4], yaw: 90 * DEG, shift: 60 });
    c.setFraming({ width: 180, height: 180, hfovDeg: 74 });
    return c;
  };
  const a = new Engraver({ width: 180, height: 180, ss: 1 });
  const b = new Engraver({ width: 180, height: 180, ss: 1 });
  a.render(w, cam(), catalog, {});
  b.render(w, cam(), catalog, {});
  assert.deepEqual(Array.from(a.plate.T), Array.from(b.plate.T));
});

test('building somewhere else does not redraw the handwriting here', () => {
  // The bug this pins is a builder-killer and is invisible in a still: face
  // ids are an incrementing counter over the block map, so inserting one block
  // renumbers every face after it.  If the stroke wobble, the ragged ends and
  // the omitted masonry perpends are hashed off that number, laying a single
  // paving slab re-draws the hand across the whole plate and the drawing
  // shivers every time you click.  Seeds come from the block's ADDRESS.
  const cam = () => {
    const c = new Camera({ eye: [1.5, -7, 1.5], yaw: 90 * DEG, shift: 70 });
    c.setFraming({ width: 200, height: 200, hfovDeg: 74 });
    return c;
  };
  const build = (extra) => {
    const w = new World(catalog);
    for (let x = -2; x <= 2; x++) for (let z = 0; z <= 3; z++) w.place(x, 2, z, 'ashlar');
    // A block whose key sorts BEFORE the wall, so it renumbers everything.
    if (extra) w.place(-9, -9, -9, 'pier');
    const e = new Engraver({ width: 200, height: 200, ss: 1 });
    e.render(w, cam(), catalog, {});
    return e.plate.T;
  };
  const a = build(false), b = build(true);
  let differing = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) differing++;
  assert.equal(differing, 0,
    `${differing} pixels of an untouched wall changed when a block was added far away`);
});

test('every scene builds and puts something on the plate', () => {
  for (const id of Object.keys(scenes)) {
    // A cube scene's world is expressed in the MODULE registry, so it must be
    // rendered with that registry — hand the engraver the block catalogue and
    // it looks up ids that are not in it and draws a blank sheet.
    const cat = catalogFor(id, catalog);
    const w = buildScene(id, cat);
    assert.ok(w.blocks.size > 0, `${id} built nothing`);
    // Frame each scene from ITS OWN bounds.  A fixed camera for every scene
    // tests the camera, not the scene — the first version of this failed on
    // `probe` purely because that scene is a long row and the shot missed it.
    const b = w.bounds();
    const eng = new Engraver({ width: 200, height: 240, ss: 1 });
    const cam = new Camera({
      eye: [(b.lo[0] + b.hi[0]) / 2, b.lo[1] - (b.hi[1] - b.lo[1]) - 6, b.lo[2] + 2],
      yaw: 90 * DEG, shift: 50,
    });
    cam.setFraming({ width: 200, height: 240, hfovDeg: 80 });
    const r = eng.render(w, cam, cat, {});
    const ink = eng.plate.meanInk();
    assert.ok(r.faces > 0, `${id} drew no faces`);
    // Say the number. An instrument that only reports pass/fail makes you
    // rebuild it from scratch to find out how close the miss was.
    assert.ok(ink > 0.005, `${id} came back as a blank sheet — mean ink ${ink.toFixed(4)}`);
  }
});

/* ----------------------------------------------------------------- cubes */

test('a sliced form is ONE object: its tiles cancel their cut faces', () => {
  // The whole claim of the slicing path. Two neighbouring tiles of a great
  // vault evaluate the same arc at the same boundary, so their cut faces are
  // identical and vanish. If they stop cancelling, the vault is not one
  // forty-eight-metre arc any more — it is twelve small ones with membranes
  // between them, and it will read as twelve.
  const cat = buildModules();
  const w = new World(cat);
  stampCompound(w, cat, 0, 0, 0, 'great-vault');
  const eng = new Engraver({ width: 300, height: 260, ss: 1 });
  const cam = new Camera({ eye: [24, -40, 6], yaw: 90 * DEG, shift: 40 });
  cam.setFraming({ width: 300, height: 260, hfovDeg: 70 });
  const r = eng.render(w, cam, cat, { hatching: false, coursing: false });
  assert.equal(w.size, 12, 'a 4x1x3 compound is twelve tiles');
  assert.ok(r.cancelled > 100, `only ${r.cancelled} faces cancelled — the tiles are not meeting`);
});

test('a vault sheet is taller than its own rise', () => {
  // A semicircular arch of span S rises S/2, so a sheet only as tall as the
  // rise has ZERO stone over its crown and comes back as a paper-thin shell
  // with a slot along the top. Same law as an arch block, one scale up.
  const cat = buildModules();
  for (const id of ['great-vault', 'half-vault', 'great-arch']) {
    const c = cat.compounds.get(id);
    const spanCubes = id === 'half-vault' ? 4 : c.tiles[0];   // half is half an arc
    assert.ok(c.tiles[2] > spanCubes / 2,
      `${id} is ${c.tiles[2]} cubes tall for a ${spanCubes / 2}-cube rise`);
  }
});

test('a cube is a cube, and a compound stamps exactly its own volume', () => {
  const cat = buildModules();
  for (const def of cat.values()) {
    assert.deepEqual(def.size, [MODULE, MODULE, MODULE], `${def.id} is not a cube`);
  }
  const w = new World(cat);
  stampCompound(w, cat, 0, 0, 0, 'bay');
  assert.equal(w.cellCount, MODULE ** 3);
  w.clear();
  stampCompound(w, cat, 0, 0, 0, 'great-vault');
  assert.equal(w.cellCount, 12 * MODULE ** 3, 'twelve tiles, no overlap and no gap');
});

test('a turned compound occupies a turned footprint and no cell twice', () => {
  const cat = buildModules();
  const w = new World(cat);
  stampCompound(w, cat, 0, 0, 0, 'great-vault', 1);      // 4x1 cubes -> 1x4
  assert.equal(w.cellCount, 12 * MODULE ** 3, 'a turn must not make tiles collide');
  assert.ok(w.at(0, 3 * MODULE, 0), 'the compound must run along +y once turned');
  assert.equal(w.at(3 * MODULE, 0, 0), null, 'and must not run along +x');
});

test('the tone transfer curve is monotonic', () => {
  // Pinned because it was NOT, and nothing in any picture said so: asking for
  // tone 0.50 produced a lighter plate than 0.44, because a second hatch
  // family switched on abruptly and halved every stroke's width.
  const w = new World(catalog);
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.place(x, 5, z, 'ashlar');
  const cam = new Camera({ eye: [0.5, 0, 0.5], yaw: 90 * DEG, shift: 0 });
  cam.setFraming({ width: 200, height: 200, hfovDeg: 60 });
  const eng = new Engraver({ width: 200, height: 200, ss: 1 });
  let prev = -1;
  for (let i = 0; i <= 10; i++) {
    eng.render(w, cam, catalog, { skin: 'hatch', coursing: false, lines: false, sky: false, forceTone: i / 10 });
    const ink = eng.plate.meanInk();
    assert.ok(ink >= prev - 1e-3, `tone ${(i / 10).toFixed(2)} gave ${ink.toFixed(3)}, less than ${prev.toFixed(3)}`);
    prev = ink;
  }
  assert.ok(prev > 0.75, `the darkest register only reached ${prev.toFixed(3)} ink`);
});

/* ------------------------------------------------------------ the layers -- */

test('the layer bands hold the owner\'s numbers: ghost 0–30, below base+30…40', () => {
  // The spec, verbatim: "if the full tonal range went from 0-100 with 0 being
  // pure white and 100 being black, the values of the ghost layers would be
  // from 0-30 and the dark layers would be base value +30 to 40."
  for (const base of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const up of [1, 2, 3, 4]) {
      const g = bandTone(base, up);
      assert.ok(g > 0 && g <= 0.30, `a layer ${up} up drew at ${(g * 100).toFixed(0)}, outside 0–30`);
    }
    for (const down of [1, 2, 3, 4]) {
      const d = bandTone(base, -down);
      const lift = (d - bandTone(base, 0)) * 100;
      assert.ok(d >= bandTone(base, 0), 'a layer below must never be lighter than the working layer');
      assert.ok(d >= 1 - 1e-9 || (lift >= 29.9 && lift <= 40.1),
        `a layer ${down} down lifted by ${lift.toFixed(0)}, outside 30–40`);
    }
  }
});

test('explore mode has no layers, so it must not band the tone at all', () => {
  // A null band and a zero band are different states.  Zero is "the layer you
  // are working on", which is drawn with headroom so the layer below has
  // somewhere to be darker; null is "there are no layers here", and inside the
  // building the stone must be as dark as the stone is.
  for (const t of [0.1, 0.44, 0.8]) {
    assert.equal(bandTone(t, null), t, 'explore mode repainted the stone');
    assert.ok(bandTone(t, 0) < t, 'the working layer must keep headroom');
  }
  assert.equal(bandLine(null), 1);
});

test('a ghosted layer does not hide the layer being worked on', () => {
  // THE WHOLE POINT OF THE SECOND PASS.  Ghosting exists so you can see what is
  // above you; if the layers above shared the working layer's stencil they
  // would occlude the thing you are trying to build on, and the feedback would
  // be worse than none.
  const cat = buildCatalog2(6, 1);
  const ids = [...cat.keys()];
  const w = new World(cat);
  w.place(0, 0, 0, ids[0]);
  const cam = new Camera({});
  buildCamera(cam, { centre: [LAYER / 2, LAYER / 2], layer: 0, yaw: 0.8, zoom: 1, width: 220, height: 160 });
  const eng = new Engraver({ width: 220, height: 160, ss: 1 });

  const alone = eng.render(w, cam, cat, { bandOf: bandFor(0) });
  // A lid right over the working block, seen from a camera looking down at it.
  w.place(0, 0, LAYER, ids[1]);
  const under = eng.render(w, cam, cat, { bandOf: bandFor(0) });

  assert.ok(under.ghosted > 0, 'the layer above was not drawn as a ghost at all');
  assert.ok(under.visible >= alone.visible * 0.9,
    `the working layer lost ${alone.visible - under.visible} of ${alone.visible} faces behind a ghost`);
});

test('no face ever asks the hatcher for a tone of NaN', () => {
  // It happened, and it was silent.  Iron carries a +0.28 material bias on top
  // of a value already near 1 on an unlit face, so tone went over 1, `1 − t`
  // went negative, and a fractional power of a negative number is NaN.  NaN
  // fails every comparison, so it sails through the hatcher's own "too light to
  // draw" guard and comes out as strokes of NaN width: the ironwork on the
  // darkest faces was simply MISSING, and no picture said so.
  const cat = buildCatalog2(12, 1);
  const ids = [...cat.keys()];
  const w = new World(cat);
  let k = 0;
  for (let L = 0; L < 2; L++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    w.place(x * LAYER, y * LAYER, L * LAYER, ids[(k++ * 3) % ids.length]);
  }
  const cam = new Camera({});
  buildCamera(cam, { centre: [LAYER, LAYER], layer: 0, yaw: 0.8, zoom: 1, width: 240, height: 170 });
  const eng = new Engraver({ width: 240, height: 170, ss: 1 });
  eng.render(w, cam, cat, { bandOf: bandFor(0) });
  const bad = eng.faceTone.filter((t) => Number.isNaN(t)).length;
  assert.equal(bad, 0, `${bad} faces asked for a tone of NaN and drew nothing`);
});

/* -------------------------------------------------------------- the skin -- */

test('the stone skin is a middle grey: nothing is paper and nothing is black', () => {
  // "lets try a middle grey with a stone texture" — the etching's own tone curve
  // is built for bare paper against near-solid black, and handed straight to a
  // fill it makes the model read as painted card.  The stone skin remaps into a
  // band that never reaches either end, and the texture may not push it out.
  for (let i = 0; i <= 20; i++) {
    const v = stoneRange(i / 20);
    assert.ok(v >= 0.20 && v <= 0.78, `a face at ${i / 20} landed at ${v.toFixed(2)}`);
  }
  assert.ok(stoneRange(1) - stoneRange(0) > 0.35, 'the band must still hold a usable range of value');
});

test('the stone texture is band-limited, so a distant surface stops fizzing', () => {
  // An octave finer than a pixel does not add detail, it adds CRAWLING noise
  // the moment the camera moves — and the build camera is near-orthographic
  // from 420 cells back while the explore camera is inside the room, so both
  // extremes happen in one session.
  const near = [], far = [];
  for (let i = 0; i < 400; i++) {
    const p = [i * 0.013, i * 0.021 + 3, i * 0.007 + 1];
    near.push(stoneAt(p[0], p[1], p[2], 0.004));
    far.push(stoneAt(p[0], p[1], p[2], 0.9));
  }
  const swing = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(swing(far) < swing(near) * 0.6,
    `the far sample swings ${swing(far).toFixed(3)} against ${swing(near).toFixed(3)} near — it is not being filtered`);
  assert.ok(swing(near) > 0.08, 'the texture must actually be visible up close');
});

test('the stone skin draws no hatching at all, and the engraver still can', () => {
  // The two skins are different pictures, not a setting on one picture.  The
  // engraver is kept whole because it is wanted for another project.
  const cat = buildCatalog2(4, 1);
  const w = new World(cat);
  w.place(0, 0, 0, [...cat.keys()][0]);
  const cam = new Camera({});
  buildCamera(cam, { centre: [LAYER / 2, LAYER / 2], layer: 0, yaw: 0.8, zoom: 1, width: 200, height: 150 });
  const eng = new Engraver({ width: 200, height: 150, ss: 1 });

  const stone = eng.render(w, cam, cat, { skin: 'stone' });
  assert.equal(stone.hatchLines, 0, 'the stone skin drew hatching');
  assert.ok(eng.plate.stats.filled > 500, 'the stone skin filled nothing');
  assert.ok(stone.ink > 0.02, 'the stone skin put no tone on the sheet');

  const hatch = eng.render(w, cam, cat, { skin: 'hatch' });
  assert.ok(hatch.hatchLines > 100, `the engraver drew only ${hatch.hatchLines} strokes — it has been broken`);
  assert.equal(eng.plate.stats.filled, 0, 'the engraver filled an area; it must be all line');
});

/* ------------------------------------------------------------ the cube law */

test('the cube law: two radii, nine planes, and a block of nine yards cubed', () => {
  // The owner's spec of 2026-08-06, pinned as numbers so a later "tidy-up" of
  // the constants has to argue with it.  Every one was read off his diagram and
  // agreed with the photograph to better than 1.5% of the block's width; the
  // UNIT was the one thing the drawing could not settle, and he settled it —
  // "its actually 9x9 blocks if you want to get technical."
  // "the blocks are 9 yards cubed if i am not mistaken."  A SUB-BLOCK IS ONE
  // YARD, which is why every number in his spec is a small round one, and the
  // international yard is 0.9144 m by definition so nothing here is rounded.
  assert.equal(SUB, 9, 'the block is nine sub-blocks on a side');
  assert.equal(SUB_YARDS, 1, 'a sub-block is one yard');
  assert.equal(SUB_FEET, 3);
  assert.equal(BLOCK_YARDS, 9);
  assert.equal(BLOCK_FEET, 27);
  assert.equal(METRES_PER_SUB, 0.9144, 'the international yard, exactly');
  assert.ok(Math.abs(BLOCK_METRES - 8.2296) < 1e-4, `the block came out ${BLOCK_METRES} m`);
  // "the one whole block circle of 4.5" — in a block of nine that is exactly
  // half, so its circle is inscribed and tangent to all four faces.  If this
  // ever stops being true, arches stop springing on the boundary planes and
  // neighbouring vaults stop meeting.
  assert.ok(Math.abs(R_WHOLE - SUB / 2) < 1e-12, 'the whole-block circle must be inscribed');
  assert.equal(R, 2.5);
  assert.ok(onPlane(0) && onPlane(SUB) && onPlane(SUB / 2), 'the boundary and the axis are planes');
  for (const v of [0, 2, 2.5, 3, 4.5, 6, 6.5, 7, 9]) {
    assert.ok(onPlane(v), `${v} is one of his coloured lines and must be a plane`);
  }
  // And the reason his unit is the right one: this form is "mostly for making
  // high vaulted arches", so its span has to be a vault and not a doorway.
  const span = R_WHOLE * 2;
  assert.equal(span, BLOCK_YARDS, `the whole-block arch spans ${span} yd, not the block's ${BLOCK_YARDS}`);
  assert.ok(1.75 / BLOCK_METRES < 0.25, 'a man must be a small fraction of a block');
});

test('every primary form that offers a face on the joint actually cancels it', () => {
  // THE NUMBER THE WHOLE LAW EXISTS TO MOVE.  Before the cube law, a run of
  // composed blocks cancelled ZERO faces — two procedurally different masses
  // never put a face in the same place, so a row of blocks was a row of
  // separate boxes and coincidence culling, the thing that turns a colonnade
  // into a tunnel, never fired once.
  const cat = new Map();
  for (const id of Object.keys(FORMS)) {
    const mesh = FORMS[id]();
    mesh.finish();
    cat.set(id, { id, name: id, family: 'primary', size: [SUB, SUB, SUB], mesh, layer: STRUCTURE });
  }
  const cam = new Camera({ eye: [SUB * 3, -SUB * 4, SUB * 2], yaw: 60 * DEG, pitch: 0.5 });
  cam.setFraming({ width: 200, height: 160, hfovDeg: 50 });
  const eng = new Engraver({ width: 200, height: 160, ss: 1 });

  // The ring hash the renderer itself uses, so this asks the same question the
  // renderer asks rather than a plausible-looking substitute.
  const ring = (m, f, dy = 0) => f.v.map((i) => m.verts[i])
    .map((p) => `${Math.round(p[0] * 8192)}:${Math.round((p[1] + dy) * 8192)}:${Math.round(p[2] * 8192)}`)
    .sort().join('|');

  for (const [id, def] of cat) {
    const m = def.mesh;
    const w = new World(cat);
    for (let i = 0; i < 3; i++) w.place(0, i * SUB, 0, id);
    const r = eng.render(w, cam, cat, { skin: 'stone', lines: false });

    // Does this form actually PRESENT a matching pair?  Slide its +y faces one
    // block along and see whether any lands exactly on a -y face.  Asserting
    // cancellation without checking this would fail a form that is correctly
    // asymmetric — `niche` bites a half-round out of one face only, so its two
    // ends genuinely differ and its neighbour's flat wall correctly closes the
    // recess instead of dissolving into it.
    const minus = new Set(m.faces.filter((f) => f.side === '-y').map((f) => ring(m, f, SUB)));
    const matches = m.faces.filter((f) => f.side === '+y' && minus.has(ring(m, f))).length;

    if (matches === 0) {
      assert.equal(r.cancelled, 0,
        `${id} presents no matching pair, so nothing should cancel, yet ${r.cancelled} did`);
      continue;
    }
    assert.ok(r.cancelled > 0,
      `${id} presents ${matches} matching faces on the joint and cancelled none — the law is broken`);
  }
});

test('a bored block reads as one mass, not as a ring of wedges', () => {
  // The mesh has no notion of a hole, so a bored block is cut into pieces and
  // the cuts are arbitrary surfaces both pieces own.  Untagged, they print as
  // creases and the block looks assembled from segments.
  const m = FORMS.shaft();
  m.finish();
  const cat = new Map([['shaft', { id: 'shaft', name: 'shaft', family: 'primary', size: [SUB, SUB, SUB], mesh: m, layer: STRUCTURE }]]);
  const w = new World(cat);
  w.place(0, 0, 0, 'shaft');
  const cam = new Camera({ eye: [SUB * 2, -SUB * 2, SUB * 2], yaw: 60 * DEG, pitch: 0.5 });
  cam.setFraming({ width: 200, height: 160, hfovDeg: 50 });
  const eng = new Engraver({ width: 200, height: 160, ss: 1 });
  const r = eng.render(w, cam, cat, { skin: 'stone', lines: false });
  assert.ok(r.cancelled >= 8, `only ${r.cancelled} internal cut faces cancelled; the wedges will show`);
});

test('the outer wall of a bored block is never mistaken for an internal cut', () => {
  // When the circle is tangent to the square, a corner piece runs corner →
  // tangent ALONG the block's own edge — one end on the arc, one not, which the
  // radius test alone calls a cut.  Tagging the outer wall as internal would
  // quietly kill the cancellation between neighbouring blocks.
  const m = FORMS['bore-y']();
  m.finish();
  const onBoundary = m.faces.filter((f) => f.side && f.side !== 'cut').length;
  assert.ok(onBoundary >= 8, `only ${onBoundary} faces kept a real boundary tag`);
  for (const f of m.faces) {
    if (f.side !== 'cut') continue;
    // a cut may not lie on a boundary plane
    for (const [ax, at] of [[0, 0], [0, SUB], [1, 0], [1, SUB], [2, 0], [2, SUB]]) {
      const all = f.v.every((i) => Math.abs(m.verts[i][ax] - at) < 1e-6);
      assert.ok(!all, `a face on the plane ${'xyz'[ax]}=${at} was tagged as an internal cut`);
    }
  }
});

/* ------------------------------------------------------------- solidity -- */

test('a block reserves its whole box but only blocks light where it has stone', () => {
  // The two questions are different and conflating them cost the light model
  // everything it was built for.  Measured before solidity.js existed: ALL
  // eleven primary forms occupied 27 cells of 27 — including `bore-y`, which is
  // a tunnel you can see straight through.  So an arcade let no light through
  // its arches and a colonnade was exactly as opaque as a wall.
  const cat = new Map();
  for (const id of Object.keys(FORMS)) {
    const mesh = FORMS[id]();
    mesh.finish();
    cat.set(id, { id, name: id, family: 'primary', size: [SUB, SUB, SUB], mesh, layer: STRUCTURE });
  }
  const cells = SUB ** 3;
  for (const id of cat.keys()) {
    const w = new World(cat);
    w.place(0, 0, 0, id);
    assert.equal(w.cellCount, cells, `${id} must RESERVE its whole box`);
    assert.ok(w.solid.size > 0, `${id} became invisible to light entirely`);
    assert.ok(w.solid.size <= cells);
  }
  // The ones that must be see-through, and the one that must not.
  assert.equal(new WorldWith(cat, 'solid').solid.size, cells, 'a solid block must stop everything');
  for (const id of ['vault-y', 'bore-y', 'column', 'corner-shafts']) {
    const n = new WorldWith(cat, id).solid.size;
    assert.ok(n < cells * 0.7, `${id} blocks ${n} of ${cells} cells — light cannot get through it`);
  }
});

class WorldWith extends World {
  constructor(cat, id) { super(cat); this.place(0, 0, 0, id); }
}

test('the solidity sample never lands on the block mid-plane', () => {
  // A block is three cells on a side, so a cell CENTRE is 0.5, 1.5, 2.5 — and
  // 1.5 is the block's own mid-plane, where every arc in the game is struck
  // from, where a vault springs, and where the whole-block circle is tangent to
  // the walls.  Sampling there asks the ray cast the one question it cannot
  // answer, and it answered wrong: a bore came back SOLID down its own axis.
  // Within a cell, the fractions that ARE slice planes are 0 and 1 (the cell
  // edges, which are sub-block boundaries) and 0.5 — because two of his planes,
  // 2.5 and 6.5, fall in the middle of a cell.  Those are what to avoid.
  for (const o of SAMPLE_OFFSETS) {
    for (const bad of [0, 0.5, 1]) {
      assert.ok(Math.abs(o - bad) > 0.05,
        `sample offset ${o} sits on ${bad}, which is a plane the forms use`);
    }
  }
});

test('a rotated block keeps its light holes where its stone is not', () => {
  // world.js has to undo the placement turn to read a block-local mask, and if
  // that inverse is wrong the holes end up on the wrong side — which nothing in
  // any picture would say, because the block still looks correct.
  const mesh = FORMS['half-vault']();
  mesh.finish();
  const cat = new Map([['hv', { id: 'hv', name: 'hv', family: 'primary', size: [SUB, SUB, SUB], mesh, layer: STRUCTURE }]]);
  const counts = [0, 1, 2, 3].map((rot) => {
    const w = new World(cat);
    w.place(0, 0, 0, 'hv', rot);
    return w.solid.size;
  });
  assert.ok(counts.every((c) => c === counts[0]),
    `a turn changed how much stone the block has: ${counts.join(', ')}`);
  assert.ok(counts[0] > 0 && counts[0] < SUB ** 3);
});

/* -------------------------------------------------------------- anchors -- */

const stackCat = buildStack(16, 1);

test('an anchor is a PLACE the block declares; its KIND is the player\'s', () => {
  // "my gut says that what they are should be player selected.  start them off
  // as a red cube that can be clicked on to select, none, torch, ring."
  for (const d of stackCat.values()) {
    for (const a of d.anchors || []) {
      assert.equal(a.kind, null, `${d.id} shipped an anchor that had already decided it was a ${a.kind}`);
    }
  }
  assert.deepEqual(KIND_IDS, ['none', 'ring', 'torch']);
  // The kind lives on the WORLD, not the block: a definition is shared by every
  // copy of it in the building, so setting a torch on one would light them all.
  const w = new World(stackCat);
  const id = [...stackCat.keys()].find((k) => (stackCat.get(k).anchors || []).length);
  w.place(0, 0, 0, id);
  w.place(0, LAYER * 3, 0, id);
  const sites = survey(w, stackCat);
  w.setAnchorKind(sites[0].id, 'torch');
  const after = survey(w, stackCat);
  assert.equal(after.filter((s) => s.kind === 'torch').length, 1,
    'setting one anchor set every copy of that block');
});

test('a wall in front of an anchor makes it unviable, and taking it away brings it back', () => {
  // "if a solid brick wall with an anchor point has another solid wall placed
  // in front of that anchor point it wont even be visible because it wont be
  // considered a viable point so you don't have to render it."
  const id = [...stackCat.keys()].find((k) => (stackCat.get(k).anchors || []).length);
  const solidId = 'b0';
  const w = new World(stackCat);
  w.place(0, 0, 0, id);

  const before = survey(w, stackCat).filter((s) => s.viable);
  assert.ok(before.length, 'the test block has no viable anchors to begin with');

  // Wall it in on all four sides.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    w.place(dx * LAYER, dy * LAYER, 0, solidId);
  }
  const walled = survey(w, stackCat).filter((s) => s.viable);
  assert.ok(walled.length < before.length,
    `walling the block in changed nothing: ${before.length} viable before and after`);

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    w.remove(dx * LAYER, dy * LAYER, 0);
  }
  const freed = survey(w, stackCat).filter((s) => s.viable);
  assert.equal(freed.length, before.length, 'the sites did not come back when the walls did');
});

test('a turned block carries its anchors round with it', () => {
  // The world position comes from the SAME quarter-turn the mesh gets.  Derive
  // it any other way and a turned block ends up with its torches on the wrong
  // wall — which looks entirely plausible until you turn the block back.
  const id = [...stackCat.keys()].find((k) => (stackCat.get(k).anchors || []).length);
  const seen = new Set();
  for (const rot of [0, 1, 2, 3]) {
    const w = new World(stackCat);
    w.place(0, 0, 0, id, rot);
    for (const s of survey(w, stackCat)) {
      // The site must still be ON its own block, whatever the turn.
      assert.ok(s.p[0] >= -1e-9 && s.p[0] <= LAYER + 1e-9, `x ${s.p[0]} left the block at rot ${rot}`);
      assert.ok(s.p[1] >= -1e-9 && s.p[1] <= LAYER + 1e-9, `y ${s.p[1]} left the block at rot ${rot}`);
      // …and its normal must point straight out of the face it names.
      const n = s.n;
      assert.ok(Math.abs(Math.hypot(n[0], n[1]) - 1) < 1e-9, 'the normal stopped being a unit vector');
      seen.add(s.side);
    }
  }
  assert.ok(seen.size > 1, 'every turn put the anchors on the same side; the rotation is a no-op');
});

test('a save keeps what the player chose, and a removed block forgets it', () => {
  const id = [...stackCat.keys()].find((k) => (stackCat.get(k).anchors || []).length);
  const w = new World(stackCat);
  w.place(0, 0, 0, id);
  const s = survey(w, stackCat)[0];
  w.setAnchorKind(s.id, 'ring');

  const back = World.fromJSON(stackCat, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(back.anchorKind(s.id), 'ring', 'the choice did not survive a save');

  // And the choices must load AFTER the blocks: `place` forgets the anchors at
  // its own address, so loading them first would have the building erase them
  // as it went up.
  assert.equal(survey(back, stackCat).find((x) => x.id === s.id).kind, 'ring');

  w.remove(0, 0, 0);
  assert.equal(w.anchorKind(s.id), undefined,
    'a removed block left its settings behind for whatever is put there next');
});
