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
import { buildScene, scenes } from '../js/scenes.js';

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
    const w = buildScene(id, catalog);
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
    const r = eng.render(w, cam, catalog, {});
    assert.ok(r.faces > 0, `${id} drew no faces`);
    assert.ok(eng.plate.meanInk() > 0.005, `${id} came back as a blank sheet`);
  }
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
    eng.render(w, cam, catalog, { coursing: false, lines: false, sky: false, forceTone: i / 10 });
    const ink = eng.plate.meanInk();
    assert.ok(ink >= prev - 1e-3, `tone ${(i / 10).toFixed(2)} gave ${ink.toFixed(3)}, less than ${prev.toFixed(3)}`);
    prev = ink;
  }
  assert.ok(prev > 0.75, `the darkest register only reached ${prev.toFixed(3)} ink`);
});
