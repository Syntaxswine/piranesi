// test/store.test.mjs — THE SAVE SYSTEM, and the ways a save loses work.
//
// A save feature with no tests is a rumour. Everything here is about the same
// question asked from different sides: when this goes wrong, does the player
// find out, or do they find out in six months when they open the file?

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Store, KEYS, OLD, readFile, blocksToFile, buildingToFile, buildingText, slug } from '../js/store.js';
import { describe as read, nameOf, shelfToText, shelfFromText } from '../js/naming.js';
import { World } from '../js/world.js';
import { buildCatalog, blockFromRecipe, add } from '../js/stack.js';
import { PLAN_IDS } from '../js/plan.js';
import { everyBlock } from '../js/enumerate.js';
import { measure, profile, keyOf } from '../js/measure.js';
import { junctionOnFloor, junctionOf } from '../js/aperture.js';

const STAIR = 'D:00ii,004i!609in,6eii:stone';
const COLUMNS = 'D:~oooo,~oooo,~oooo:stone';
const OLD_LADDER = 'D:00ii,004i!609in,5eii:stone';   // drawn before R came down to 2

/** A localStorage stand-in, so the whole store is testable without a browser. */
function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/* ------------------------------------------------------------- the upgrade */

test('the old keys are brought across, and are NOT deleted', () => {
  // An upgrade that throws away the thing it is upgrading has no way back if it
  // turns out to be wrong, and this is somebody's work.
  const s = fakeStorage({
    [OLD.drawn]: JSON.stringify([STAIR, COLUMNS]),
    [OLD.save]: JSON.stringify({ format: 'piranesi/3', palette: ['S:full,full,full:stone'], cells: [[0, 0, 0, 0]] }),
    [`${OLD.save}:attic`]: JSON.stringify({ format: 'piranesi/3', palette: [COLUMNS], cells: [[0, 0, 0, 0]] }),
  });
  const store = new Store(s);

  assert.deepEqual(store.blocks(), [STAIR, COLUMNS], 'the old shelf came across');
  const names = store.buildings().map((b) => b.name);
  assert.equal(names.length, 2, 'the old save AND its `?slot=` companion came across');
  assert.ok(names.includes('the first building'));
  assert.ok(names.includes('attic'), 'the slot mechanism was the only way to have two; both survive');

  assert.ok(s.m.has(OLD.drawn), 'the old shelf key is still there');
  assert.ok(s.m.has(OLD.save), 'the old save key is still there');
  assert.ok(store.drain().length >= 2, 'and it said what it did');
});

test('a shelf that was never migrated twice does not migrate twice', () => {
  const s = fakeStorage({ [OLD.drawn]: JSON.stringify([STAIR]) });
  const store = new Store(s);
  store.blocks();
  store.addBlock(COLUMNS);
  assert.deepEqual(store.blocks(), [STAIR, COLUMNS], 'the second read uses the new key, not the old one');
});

/* --------------------------------------------------------------- the shelf */

test('a recipe IS the block, so keeping one twice is keeping it once', () => {
  const store = new Store(fakeStorage());
  assert.equal(store.addBlock(STAIR).ok, true);
  const again = store.addBlock(STAIR);
  assert.equal(again.ok, false);
  assert.match(again.why, /already on the shelf/);
  assert.equal(store.blocks().length, 1);
});

test('a block this version cannot build is REPORTED, never quietly dropped', () => {
  // The slice-plane ladder changed on 2026-08-07 — R 2.5 to 2 — so every
  // drawing made before that carries a coordinate that is no longer a plane.
  // Silently returning a shorter shelf is how somebody loses work and never
  // learns they had it.
  const store = new Store(fakeStorage({ [KEYS.shelf]: JSON.stringify([STAIR, OLD_LADDER]) }));
  assert.deepEqual(store.blocks(), [STAIR], 'the working list holds only what builds');
  const said = store.drain().join(' ');
  assert.match(said, /cannot be built/);
  assert.match(said, /5eii/, 'and it names the recipe, so it can be repaired by hand');

  // AND IT IS STILL IN STORAGE. A later version may be able to build it again;
  // dropping it from the file would make that impossible.
  assert.equal(store.addBlock(OLD_LADDER).ok, false, 'it cannot be re-added…');
  assert.ok(JSON.parse(store.s.getItem(KEYS.shelf)).includes(OLD_LADDER), '…but it was never deleted');
});

test('a write that fails says so, and the caller can tell', () => {
  // THE QUOTA IS THE FAILURE MODE THAT LOSES WORK. The previous code caught the
  // exception with an empty block, so the game went on placing blocks, saving
  // none of them, and the player found out on reload.
  const s = fakeStorage();
  s.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const store = new Store(s);
  assert.equal(store.put('k', 1), false);
  assert.match(store.drain().join(' '), /out of storage/);
});

test('storage that will not parse is reported and LEFT ALONE', () => {
  const s = fakeStorage({ [KEYS.shelf]: '{not json' });
  const store = new Store(s);
  assert.deepEqual(store.blocks(), []);
  assert.match(store.drain().join(' '), /unreadable/);
  assert.equal(s.getItem(KEYS.shelf), '{not json',
    'deleting it would be the one irreversible thing this module could do');
});

/* ------------------------------------------------------------ the buildings */

test('a building is saved, reopened, renamed and deleted by name', () => {
  const store = new Store(fakeStorage());
  const cat = buildCatalog(4, 1);
  add(cat, STAIR);
  const w = new World(cat);
  w.place(0, 0, 0, STAIR);
  w.place(9, 0, 0, STAIR);

  assert.equal(store.saveBuilding('the gallery', w.toJSON(), { layer: 2 }), true);
  assert.equal(store.openName(), 'the gallery', 'saving opens it');
  assert.equal(store.building('the gallery').world.cells.length, 2);
  assert.equal(store.building('the gallery').view.layer, 2, 'the view rides along, in storage only');

  assert.equal(store.renameBuilding('the gallery', 'the long gallery'), true);
  assert.equal(store.openName(), 'the long gallery', 'and the rename follows the open one');
  assert.equal(store.building('the gallery'), null);

  store.saveBuilding('another', w.toJSON());
  assert.equal(store.renameBuilding('another', 'the long gallery'), false, 'names do not collide silently');
  assert.match(store.drain().join(' '), /already a building/);

  store.removeBuilding('another');
  assert.deepEqual(store.buildings().map((b) => b.name), ['the long gallery']);
});

test('a building outlives the blocks it was built from', () => {
  // THE WHOLE POINT OF THE PALETTE. Take a block off the shelf and every
  // building made with it still loads, because the save carries the recipe.
  const store = new Store(fakeStorage());
  const cat = buildCatalog(4, 1);
  add(cat, STAIR);
  const w = new World(cat);
  w.place(0, 0, 0, STAIR);
  store.addBlock(STAIR);
  store.saveBuilding('a', w.toJSON());
  store.removeBlock(STAIR);
  assert.deepEqual(store.blocks(), [], 'the block is off the shelf');

  const fresh = new Map();                       // a catalogue that has never heard of it
  const back = World.fromJSON(fresh, store.building('a').world, (r) => blockFromRecipe(r));
  assert.equal(back.size, 1, 'and the building still stands');
  assert.deepEqual(back.missing, []);
});

/* ---------------------------------------------------------------- the files */

test('a shelf file is the file this repo already reads', () => {
  // One recipe a line — `docs/kit.txt`'s format — so `blockshot --recipes @file`
  // draws an exported shelf with no converter and nothing to keep in step.
  const f = blocksToFile([STAIR, COLUMNS], 'test');
  assert.match(f.name, /\.txt$/);
  const lines = f.body.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.deepEqual(lines, [STAIR, COLUMNS], 'the bare lines are exactly the recipes');
  const back = shelfFromText(f.body);
  assert.deepEqual(back.recipes, [STAIR, COLUMNS]);
  assert.deepEqual(back.bad, []);
});

test('the names in a shelf file are comments, and are regenerated on read', () => {
  const f = blocksToFile([STAIR], 'test');
  assert.ok(f.body.includes(nameOf(STAIR)), 'the name is written…');
  // …and TAMPERING WITH IT CHANGES NOTHING. That is the whole reason it is a
  // comment: a label is not an identity, and one that could be edited into
  // disagreeing with its recipe would be a lie with a delay on it.
  const lied = f.body.replace(nameOf(STAIR), 'not-the-name-at-all');
  const back = shelfFromText(lied);
  assert.deepEqual(back.recipes, [STAIR]);
  assert.equal(nameOf(back.recipes[0]), nameOf(STAIR), 'the name comes back from the recipe');
});

test('a building file is one line per block, so a diff of two saves is a diff of two buildings', () => {
  const cat = buildCatalog(4, 1);
  add(cat, STAIR);
  const a = new World(cat), b = new World(cat);
  for (const w of [a, b]) { w.place(0, 0, 0, STAIR); w.place(9, 0, 0, STAIR); }
  const ta = buildingText(a.toJSON());
  assert.equal(ta, buildingText(b.toJSON()), 'two identical buildings serialise identically');
  assert.match(ta, /\n {2}\[0,0,0,0\],\n/, 'a cell is one line');

  // Move one block and exactly one line moves.
  b.remove(9, 0, 0);
  b.place(18, 0, 0, STAIR);
  const diff = buildingText(b.toJSON()).split('\n').filter((l, i) => l !== ta.split('\n')[i]);
  assert.ok(diff.length <= 2, `moving one block changed ${diff.length} lines`);
});

test('a file is sniffed, and something that is neither says so', () => {
  const cat = buildCatalog(4, 1);
  const w = new World(cat);
  w.place(0, 0, 0, [...cat.keys()][0]);
  assert.equal(readFile(buildingToFile('x', w.toJSON()).body).kind, 'building');
  assert.equal(readFile(blocksToFile([STAIR], 't').body).kind, 'blocks');

  for (const [text, why] of [
    ['{oops', /not readable JSON/],
    ['{"a":1}', /not a Piranesi building/],
    ['hello world', /nothing in that file is a recipe/],
    ['', /no recipes/],
  ]) {
    const got = readFile(text);
    assert.equal(got.kind, 'bad', `${JSON.stringify(text)} must be refused`);
    assert.match(got.why, why);
  }

  // A file of OLD-LADDER recipes and nothing else is a bad file, not an import
  // of zero blocks — "imported 0 blocks" reads like success.
  const old = readFile(`# a shelf from before the radius changed\n${OLD_LADDER}\n`);
  assert.equal(old.kind, 'bad');
  assert.match(old.why, /this version can build/);
});

test('slug never produces an empty or unsafe filename', () => {
  assert.equal(slug('The Long Gallery'), 'the-long-gallery');
  assert.equal(slug('///'), 'building');
  assert.equal(slug(''), 'building');
  assert.equal(slug('a/b\\c:d'), 'a-b-c-d');
});

/* --------------------------------------------------------------- the names */

test('a name is a function of the recipe and of nothing else', () => {
  assert.equal(nameOf(STAIR), nameOf(STAIR));
  assert.notEqual(nameOf(STAIR), nameOf(COLUMNS));
  assert.match(nameOf(STAIR), /^[a-z]+-[a-z-]+-[0-9a-z]{3}$/, 'junction, feature, three of the recipe hash');
  assert.equal(read(OLD_LADDER), null, 'a block that cannot be built has no type to report');
  assert.equal(nameOf(OLD_LADDER), '?');
});

test('every plan in the vocabulary gets a name, and the arches too', () => {
  for (const id of PLAN_IDS) {
    const r = `S:${id},${id},${id}:stone`;
    const d = read(r);
    assert.ok(d, `${id} must be nameable`);
    assert.equal(d.storeys.length, 3);
  }
  assert.match(read('A:y+:twin:stone').feature, /^vault-y/);
  assert.match(read('A:xl:corner:rustic').feature, /^vault-x/);
});

test('THE JUNCTION DISCRIMINATES — the ground floor, not the whole block', () => {
  // The fifth time this project has met the same law. `junctionOf` asks whether
  // a side is open ANYWHERE up the block, which is porosity, and it answers `+`
  // for 93% of the grammar. A label that says the same thing about nine blocks
  // in ten is not a label.
  const all = everyBlock().recipes;
  const step = Math.floor(all.length / 1500);
  const sheets = [];
  for (let i = 0; i < all.length; i += step) {
    const sh = measure(all[i], blockFromRecipe(all[i]));
    if (sh) sheets.push(sh);
  }
  assert.ok(sheets.length > 1000, 'a big enough sample to mean anything');

  const spread = (f) => {
    const m = new Map();
    for (const sh of sheets) { const k = f(sh); m.set(k, (m.get(k) || 0) + 1); }
    return { classes: m.size, biggest: Math.max(...m.values()) / sheets.length };
  };
  const pf = (sh) => (side) => keyOf(profile(sh.mask, side));

  const anyFloor = spread((sh) => junctionOf(pf(sh)));
  const ground = spread((sh) => junctionOnFloor(pf(sh), 0));

  assert.ok(anyFloor.biggest > 0.85,
    `porosity is meant to be lopsided; it came out ${(anyFloor.biggest * 100).toFixed(0)}%`);
  assert.ok(ground.biggest < 0.6,
    `the ground reading must spread: largest class ${(ground.biggest * 100).toFixed(0)}%`);
  assert.ok(ground.classes >= 5,
    `and populate his classes: ${ground.classes} of 6 seen`);
});
