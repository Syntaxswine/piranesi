// test/store.test.mjs — THE SAVE SYSTEM, and the ways a save loses work.
//
// A save feature with no tests is a rumour. Everything here is about the same
// question asked from different sides: when this goes wrong, does the player
// find out, or do they find out in six months when they open the file?

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import {
  Store, KEYS, OLD, bkey, readFile, blocksToFile, buildingToFile, buildingText,
  slug, hashOf, ago, FORMAT,
} from '../js/store.js';
import { describe as read, nameOf, shelfToText, shelfFromText } from '../js/naming.js';
import { World, isIndexKey } from '../js/world.js';
import { buildCatalog, blockFromRecipe, add, samplerStamp, SAMPLER } from '../js/stack.js';
import { survey, siteId, reindex } from '../js/anchors.js';
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

test('storage that will not parse is QUARANTINED before anything writes over it', () => {
  // THIS TEST USED TO ASSERT THE WRONG INVARIANT AND PASS.
  //
  // It seeded a corrupt value, called the reader, and checked the raw string
  // was unchanged — "deleting it would be the one irreversible thing this
  // module could do". True, and useless: the reader was never the thing that
  // deleted it. The reader returned an empty list, the caller worked from that,
  // and THE NEXT WRITE put the empty list over the top. One click and every
  // building was gone, with a message in the log saying nothing had been
  // touched.
  //
  // The invariant the code claimed was "a key that will not read is never
  // written over". The invariant it tested was "the reader does not delete it".
  // They differ by exactly the bug, so the test now writes afterwards.
  const k = bkey('the-gallery');
  const s = fakeStorage({
    [KEYS.index]: JSON.stringify([{ name: 'the gallery', slug: 'the-gallery' }]),
    [k]: '{not json',
  });
  const store = new Store(s);
  assert.equal(store.building('the gallery'), null);
  assert.match(store.drain().join(' '), /would not read/);

  store.saveBuilding('the gallery', { format: FORMAT, palette: [], cells: [] });
  assert.equal(s.getItem(`${k}~broken`), '{not json',
    'the original text must survive the write that follows the failed read');

  // And a second failure does not overwrite the first copy — the FIRST one is
  // the good one, and by the second the damage has already been done once.
  const store2 = new Store(s);
  s.setItem(k, '{different rubbish');
  store2.building('the gallery');
  assert.equal(s.getItem(`${k}~broken`), '{not json');
});

test('ONE BAD BYTE TAKES ONE BUILDING, not the library — BACKLOG 0v', () => {
  // The whole collection used to live in `piranesi/buildings`, so a value that
  // would not parse cost every building at once. Per-building keys shrink the
  // blast radius to the one that is actually damaged.
  const s = fakeStorage();
  const store = new Store(s);
  const w = { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] };
  store.saveBuilding('a', w);
  store.saveBuilding('b', w);
  store.saveBuilding('c', w);
  s.setItem(bkey('b'), 'not json at all');

  const fresh = new Store(s);
  assert.deepEqual(fresh.buildings().map((x) => x.name), ['a', 'c'], 'the other two are untouched');
  assert.equal(s.getItem(`${bkey('b')}~broken`), 'not json at all', 'and the damaged one is kept');
  assert.match(fresh.drain().join(' '), /would not read/);
});

test('a corrupt index is rebuilt from the buildings themselves — BACKLOG 0v', () => {
  // The index is a convenience and never the authority: the buildings are under
  // their own keys, so losing the list of them loses nothing.
  const s = fakeStorage();
  const store = new Store(s);
  const w = { format: FORMAT, palette: [], cells: [] };
  store.saveBuilding('the long gallery', w);
  store.saveBuilding('the well', w);

  s.setItem(KEYS.index, '[[[nonsense');
  const fresh = new Store(s);
  const names = fresh.index().map((e) => e.name).sort();
  assert.deepEqual(names, ['the long gallery', 'the well'], 'both came back');
  assert.match(fresh.drain().join(' '), /not in the index/);
  assert.equal(s.getItem(`${KEYS.index}~broken`), '[[[nonsense');

  // …and the repair is written, so it is not re-derived on every read.
  assert.equal(JSON.parse(s.getItem(KEYS.index)).length, 2);
});

test('a quota failure on one building does not stop another — BACKLOG 0v', () => {
  // THE POINT OF THE SPLIT. With one key, `setItem` had to fit the whole array
  // every time; once it did not, nothing could be saved at all — including a
  // brand-new building with one block in it.
  const s = fakeStorage();
  const store = new Store(s);
  const big = { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] };
  store.saveBuilding('the big one', big);

  const raw = s.setItem.bind(s);
  s.setItem = (k, v) => {
    if (k === bkey('the-big-one')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    return raw(k, v);
  };
  assert.equal(store.saveBuilding('the big one', { ...big, cells: [[0, 0, 0, 0], [9, 0, 0, 0]] }).ok, false);
  assert.match(store.drain().join(' '), /out of storage/);
  assert.equal(store.saveBuilding('a small one', { format: FORMAT, palette: [], cells: [] }).ok, true,
    'the small one still goes in — that is the whole of 0v');
});

test('the shelf keeps what it cannot build, even across a write', () => {
  // `blocks()` filters out unbuildable recipes and its comment promises they
  // are "left in storage in case a later version can build it again" — and
  // then `draw.js` did `state.shelf = store.blocks()` and wrote that filtered
  // list straight back. `draw.html` is the only place a `D:` recipe comes from,
  // so that entry is the LAST COPY of a drawn block. The function that filters
  // and the function that writes have to agree about what the shelf is.
  const s = fakeStorage({ [KEYS.shelf]: JSON.stringify(['S:full,full,full:stone', OLD_LADDER]) });
  const store = new Store(s);
  const working = store.blocks();
  store.drain();
  assert.deepEqual(working, ['S:full,full,full:stone']);

  store.setBlocks(working);                      // the round trip draw.js makes
  assert.ok(JSON.parse(s.getItem(KEYS.shelf)).includes(OLD_LADDER),
    'a recipe this version cannot build survived being saved over');
  assert.match(store.drain().join(' '), /still on the shelf, untouched/);
});

test('the draft is stored bare, so the upgrade does not eat an in-progress drawing', () => {
  // Going through `put` would JSON-quote it, and then the next boot's parse of
  // the un-quoted legacy value would throw, quarantine it and start from the
  // default: everybody's unfinished drawing lost, once, on the upgrade.
  const s = fakeStorage({ [KEYS.draft]: 'D:00ii,00ii,00ii:stone' });
  const store = new Store(s);
  assert.equal(store.draft(), 'D:00ii,00ii,00ii:stone', 'a bare legacy value reads back as itself');
  store.setDraft('D:0cii,0cii,0cii:stone');
  assert.equal(s.getItem(KEYS.draft), 'D:0cii,0cii,0cii:stone', 'and is written back bare');
});

test('a Store constructs where the browser refuses storage outright', () => {
  // Accessing `globalThis.localStorage` THROWS SecurityError in Chrome with
  // third-party cookies blocked. A default parameter is evaluated before the
  // body, so `|| memory()` never ran and the throw took the whole page with it:
  // "nothing can be saved" became "nothing loads".
  const hostile = { get getItem() { throw new Error('SecurityError'); } };
  const store = new Store(hostile);
  assert.doesNotThrow(() => store.blocks(), 'a hostile backing must not take the page down');
  assert.doesNotThrow(() => store.buildings());
  assert.equal(store.draft(), '');
});

/* ------------------------------------------------------------ the buildings */

test('a building is saved, reopened, renamed and deleted by name', () => {
  const s = fakeStorage();
  const store = new Store(s);
  const cat = buildCatalog(4, 1);
  add(cat, STAIR);
  const w = new World(cat);
  w.place(0, 0, 0, STAIR);
  w.place(9, 0, 0, STAIR);

  assert.equal(store.saveBuilding('the gallery', w.toJSON(), { layer: 2 }).ok, true);
  assert.equal(store.openName(), 'the gallery', 'saving opens it');
  assert.equal(store.building('the gallery').world.cells.length, 2);
  assert.equal(store.building('the gallery').view.layer, 2, 'the view rides along, in storage only');

  assert.equal(store.renameBuilding('the gallery', 'the long gallery'), true);
  assert.equal(store.openName(), 'the long gallery', 'and the rename follows the open one');
  assert.equal(store.building('the gallery'), null);
  // A RENAME DOES NOT MOVE THE KEY. Moving it would be a copy and a delete, and
  // this module does not delete somebody's work to accomplish a relabelling.
  assert.ok(s.m.has(bkey('the-gallery')), 'the slug is minted once and stays');
  assert.equal(store.building('the long gallery').slug, 'the-gallery');

  store.saveBuilding('another', w.toJSON());
  assert.equal(store.renameBuilding('another', 'the long gallery'), false, 'names do not collide silently');
  assert.match(store.drain().join(' '), /already a building/);

  store.removeBuilding('another');
  assert.deepEqual(store.buildings().map((b) => b.name), ['the long gallery']);
  assert.equal(s.m.has(bkey('another')), false, 'a deletion is a deletion');
});

test('two names that slug alike get two keys', () => {
  // `a b` and `a-b` both want `a-b`, and two buildings sharing a key is one
  // building with the other one gone.
  const store = new Store(fakeStorage());
  const w = { format: FORMAT, palette: [], cells: [] };
  store.saveBuilding('the well', w);
  store.saveBuilding('the-well', { ...w, cells: [[0, 0, 0, 0]] });
  const slugs = store.index().map((e) => e.slug);
  assert.deepEqual(slugs, ['the-well', 'the-well-2']);
  assert.equal(store.building('the well').world.cells.length, 0);
  assert.equal(store.building('the-well').world.cells.length, 1);
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

test('the one-key library is brought across per building, and kept — BACKLOG 0v', () => {
  const s = fakeStorage({
    [OLD.buildings]: JSON.stringify([
      { name: 'the vaults', world: { format: 'piranesi/3', palette: [], cells: [[0, 0, 0, 0]] }, view: { layer: 1 } },
      { name: 'the well', world: { format: 'piranesi/3', palette: [], cells: [] } },
    ]),
  });
  const store = new Store(s);
  assert.deepEqual(store.index().map((e) => e.name), ['the vaults', 'the well']);
  assert.equal(store.building('the vaults').view.layer, 1, 'the view came too');
  assert.ok(s.m.has(bkey('the-vaults')) && s.m.has(bkey('the-well')));
  assert.ok(s.m.has(OLD.buildings), 'and the old value is left exactly where it was');
});

test('a migration that cannot finish does not mark itself finished — BACKLOG 0v', () => {
  // A HALF-WRITTEN INDEX IS THE ONE OUTCOME THAT LOSES A BUILDING: it says the
  // upgrade is done while some of the work is still only in the old key.
  const s = fakeStorage({
    [OLD.buildings]: JSON.stringify([
      { name: 'a', world: { format: 'piranesi/3', palette: [], cells: [] } },
      { name: 'b', world: { format: 'piranesi/3', palette: [], cells: [] } },
    ]),
  });
  const raw = s.setItem.bind(s);
  s.setItem = (k, v) => {
    if (k === bkey('b')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    return raw(k, v);
  };
  const store = new Store(s);
  store.index();
  assert.equal(s.m.has(KEYS.index), false, 'the index key is NOT written, so the next boot tries again');
  assert.match(store.drain().join(' '), /tried again/);
  assert.ok(s.m.has(OLD.buildings), 'and the old value still holds both');
});

/* ------------------------------------------------------------- the two tabs */

test('TWO TABS ON ONE BUILDING: the second write is refused — BACKLOG 0u', () => {
  // Reproduced, not reasoned about. Two `Store`s over one storage IS two tabs:
  // that is the whole of the bug. Both boot into `openName()`, each holds its
  // own in-memory World, and the autosave fires on every placement — so a stray
  // click in a stale tab wrote its old world over an hour of building, and the
  // loser was always the tab with the work in it.
  const s = fakeStorage();
  const A = new Store(s), B = new Store(s);
  assert.notEqual(A.session, B.session, 'two tabs are two tabs');

  const world = (n) => ({ format: FORMAT, palette: [], cells: Array.from({ length: n }, (_, i) => [i * 9, 0, 0, 0]) });
  A.saveBuilding('the gallery', world(1));
  B.open('the gallery');                           // B opens the same one
  A.saveBuilding('the gallery', world(40));        // …and A builds for an hour

  const got = B.saveBuilding('the gallery', world(1));
  assert.equal(got.ok, false, 'B must not be allowed to write its stale world');
  assert.ok(got.conflict, 'and it says WHY, because the way out depends on it');
  assert.match(B.drain().join(' '), /changed in another tab/);
  assert.equal(A.building('the gallery').world.cells.length, 40, "A's hour is still there");
});

test('…and the three ways out of it, each keeping what it says — BACKLOG 0u', () => {
  const s = fakeStorage();
  const world = (n) => ({ format: FORMAT, palette: [], cells: Array.from({ length: n }, (_, i) => [i * 9, 0, 0, 0]) });

  // 1. SAVE AS — B keeps its own under another name and nothing is lost.
  {
    const A = new Store(s), B = new Store(s);
    A.saveBuilding('g', world(1)); B.open('g'); A.saveBuilding('g', world(40));
    assert.equal(B.saveBuilding('g (2)', world(1)).ok, true);
    assert.equal(A.building('g').world.cells.length, 40);
    assert.equal(B.building('g (2)').world.cells.length, 1);
  }
  // 2. RE-OPEN — B reads A's, and is now holding the thing it is looking at.
  {
    const s2 = fakeStorage();
    const A = new Store(s2), B = new Store(s2);
    A.saveBuilding('g', world(1)); B.open('g'); A.saveBuilding('g', world(40));
    assert.equal(B.saveBuilding('g', world(1)).ok, false);
    assert.equal(B.open('g').world.cells.length, 40, 'B re-reads');
    assert.equal(B.saveBuilding('g', world(41)).ok, true, 'and may write on top of what it read');
  }
  // 3. TAKE OVER — B says "mine", deliberately, and A is the one refused next.
  {
    const s3 = fakeStorage();
    const A = new Store(s3), B = new Store(s3);
    A.saveBuilding('g', world(1)); B.open('g'); A.saveBuilding('g', world(40));
    B.takeOver('g');
    assert.equal(B.saveBuilding('g', world(1)).ok, true);
    assert.equal(A.saveBuilding('g', world(41)).ok, false, 'and now it is A that is told');
  }
});

test('LOOKING AT THE LIST IS NOT OPENING EVERYTHING IN IT — BACKLOG 0u', () => {
  // The check is "did this tab see what is there now", and if merely READING a
  // record counted, then drawing the buildings list — which reads every one of
  // them — would tell this tab it held the lot. The guard would then pass for a
  // building this tab has never had on screen, which is the bug wearing a
  // tick-mark.
  const s = fakeStorage();
  const A = new Store(s), B = new Store(s);
  const world = (n) => ({ format: FORMAT, palette: [], cells: [[n, 0, 0, 0]] });
  A.saveBuilding('g', world(1));
  B.buildings();                                   // B draws a list
  B.summaries();                                   // …and a summary of each
  assert.equal(B.saveBuilding('g', world(2)).ok, false, 'B never opened it, so B may not write it');
  assert.equal(B.open('g').world.cells[0][0], 1, 'opening is the deliberate act');
  assert.equal(B.saveBuilding('g', world(2)).ok, true);
});

test('a building with no token is adopted, not refused — BACKLOG 0u', () => {
  // Everything already in somebody's browser was written before there were
  // tokens. Refusing those would make the upgrade look exactly like the bug.
  const s = fakeStorage({
    [KEYS.index]: JSON.stringify([{ name: 'old', slug: 'old' }]),
    [bkey('old')]: JSON.stringify({ name: 'old', slug: 'old', world: { format: FORMAT, palette: [], cells: [] } }),
  });
  const store = new Store(s);
  assert.equal(store.saveBuilding('old', { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] }).ok, true);
  assert.match(JSON.parse(s.getItem(bkey('old'))).token, new RegExp(`^${store.session}\\.`),
    'and stamped from here on');
});

/* ------------------------------------------------- which copy is which — 0x */

test('a building knows when it was written and what it contains — BACKLOG 0x', () => {
  const s = fakeStorage();
  const store = new Store(s);
  const w = { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] };
  store.saveBuilding('a', w);
  const [sum] = store.summaries();
  assert.ok(Date.parse(sum.at) > 0, 'a timestamp…');
  assert.equal(sum.hash, hashOf(w), '…and a content identity');
  assert.equal(sum.cells, 1);

  // The hash is of the CONTENT, so two buildings arrived at differently but
  // identical in fact are recognisably the same thing.
  store.saveBuilding('b', { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] });
  assert.equal(store.sameAs(w).name, 'a', 'and an import can ask before making a second copy');
  assert.equal(store.summaries()[0].hash, store.summaries()[1].hash);
  assert.equal(store.sameAs({ format: FORMAT, palette: [], cells: [] }), null);
});

test('an identical save is not a write, so the clock does not lie — BACKLOG 0x', () => {
  // The autosave fires on every click, including the ones that change nothing —
  // a right-click on empty air. A no-op that still moves the timestamp makes the
  // one number that tells two copies apart useless.
  const s = fakeStorage();
  const store = new Store(s);
  const w = { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] };
  const first = store.saveBuilding('a', w, { layer: 0 });
  const again = store.saveBuilding('a', w, { layer: 0 });
  assert.equal(again.unchanged, true);
  assert.equal(JSON.parse(s.getItem(bkey('a'))).at, first.at, 'the same content is the same save');
  // …but a change of view IS a change worth keeping, or the layer you left off
  // on never survives a reload.
  assert.equal(store.saveBuilding('a', w, { layer: 3 }).unchanged, undefined);
  assert.equal(JSON.parse(s.getItem(bkey('a'))).view.layer, 3);
});

test('the content hash is a fixed width and keeps all of itself', () => {
  // The first version padded the second half to seven characters, left the first
  // unpadded, and then took the leading thirteen — which threw away five bits of
  // the one number that decides whether an import is a copy of something already
  // here. The length varying with the value is the tell.
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const h = hashOf({ format: FORMAT, palette: [], cells: [[i, i * 3, 0, 0]] });
    assert.equal(h.length, 14, `${h} is ${h.length} characters, not 14`);
    assert.equal(seen.has(h), false, `two different buildings hashed alike at ${i}`);
    seen.add(h);
  }
});

test('the hash a building reports is its CONTENT, not what was written beside it', () => {
  // The record carries a `hash`, and trusting it would be free. It is also a
  // derived quantity written down next to the thing it derives from, and it
  // drifted on its first day: widening the hash from thirteen characters to
  // fourteen left every stored value lying, so `sameAs` would have stopped
  // recognising every building already saved.
  const s = fakeStorage();
  const store = new Store(s);
  const w = { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] };
  store.saveBuilding('a', w);
  const rec = JSON.parse(s.getItem(bkey('a')));
  rec.hash = 'a-lie-from-2019';
  s.setItem(bkey('a'), JSON.stringify(rec));

  assert.equal(store.summaries()[0].hash, hashOf(w), 'the label is regenerated on read');
  assert.equal(store.sameAs(w).name, 'a', 'so an import still recognises it');
});

test('a deletion that cannot be written does not delete', () => {
  // Every other write here puts the RECORD first, so a failure between the two
  // leaves an orphan the index can recover. A deletion is the one that wants the
  // opposite: fail, and the building must still be there.
  const s = fakeStorage();
  const store = new Store(s);
  store.saveBuilding('the well', { format: FORMAT, palette: [], cells: [[0, 0, 0, 0]] });
  const raw = s.setItem.bind(s);
  s.setItem = (k, v) => {
    if (k === KEYS.index) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    return raw(k, v);
  };
  assert.equal(store.removeBuilding('the well'), false);
  s.setItem = raw;
  assert.equal(store.building('the well').world.cells.length, 1, 'still there, and still readable');
});

test('ago says something useful at every scale', () => {
  const t = Date.parse('2026-08-08T12:00:00Z');
  assert.equal(ago(null), 'never saved');
  assert.equal(ago('2026-08-08T11:59:30Z', t), 'just now');
  assert.equal(ago('2026-08-08T11:20:00Z', t), '40m ago');
  assert.equal(ago('2026-08-08T04:00:00Z', t), '8h ago');
  assert.equal(ago('2026-08-05T12:00:00Z', t), '3d ago');
  assert.equal(ago('2026-06-08T12:00:00Z', t), '2mo ago');
  assert.equal(ago('nonsense'), '');
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

test('a building file is refused before it can reach the loader', () => {
  // `World.fromJSON` destructures every cell, so ONE non-iterable row throws a
  // TypeError — and the game used to write an imported building to storage
  // before opening it, so the throw came back on every subsequent boot with no
  // UI left to remove it. One bad file bricked the page for good. The rows are
  // checked here, before anything is kept.
  for (const [json, why] of [
    ['{"format":"piranesi/9","palette":[],"cells":[]}', /needs a newer Piranesi/],
    ['{"palette":[],"cells":[{"x":1}]}', /cell 0 is not \[x,y,z,block\]/],
    ['{"palette":[],"cells":[[0,0,0]]}', /cell 0 is not/],
    ['{"palette":[],"cells":[["a",0,0,0]]}', /cell 0 is not/],
    ['{"palette":[1,2],"cells":[[0,0,0,0]]}', /palette is not a list of recipes/],
  ]) {
    const got = readFile(json);
    assert.equal(got.kind, 'bad', `${json} must be refused`);
    assert.match(got.why, why);
  }
  // …and the same version check does NOT refuse the format we write.
  assert.equal(readFile('{"format":"piranesi/3","palette":[],"cells":[]}').kind, 'building');
});

test('loading a building with two blocks in one cell says which it lost', () => {
  // Cells are written sorted so the game's own writer cannot emit an overlap;
  // this only bites on a file that was hand-edited, merged, or made by a tool.
  // `place` clears what it overlaps by design, so without a count the block
  // just vanishes — no entry in `missing`, no warning, nothing.
  const cat = buildCatalog(4, 1);
  const id = [...cat.keys()][0];
  const w = World.fromJSON(cat, {
    format: 'piranesi/3', palette: [id], cells: [[0, 0, 0, 0], [0, 0, 0, 0]],
  }, (r) => blockFromRecipe(r));
  assert.equal(w.size, 1, 'the later one won, as `place` always does');
  assert.equal(w.displaced.length, 1, 'and the loader counted the one it lost');
});

test('slug never produces an empty or unsafe filename', () => {
  assert.equal(slug('The Long Gallery'), 'the-long-gallery');
  assert.equal(slug('///'), 'building');
  assert.equal(slug(''), 'building');
  assert.equal(slug('a/b\\c:d'), 'a-b-c-d');
});

/* -------------------------------------------------- the anchors — 0w and 0t */

/** A recipe from the standard hand that actually offers somewhere to put a
 *  torch. Not every block does — `anchorsFor` gives three in four a site. */
function anchored() {
  const cat = buildCatalog(24, 1);
  const hit = [...cat.entries()].find(([, d]) => d.anchors && d.anchors.length >= 2);
  assert.ok(hit, 'the standard hand must contain a block with anchors');
  return { cat, id: hit[0], def: hit[1] };
}

const lit = (sites) => sites.filter((s) => s.kind === 'torch').map((s) => s.p.join(',')).sort();

test('THE SAMPLER IS THE ONE THAT WROTE THE INDEX-KEYED SAVES — BACKLOG 0w', () => {
  // A PRE-REGISTERED CHECK. Bringing a `piranesi/3` save across means asking
  // today's `anchorsFor` what it deals and matching by position, which is exact
  // only while today's sampler is the one that wrote the file. If this fails,
  // the sampler has moved: `anchors.js reindex` will now refuse to touch old
  // keys, and somebody has to decide what those saves should become. DO NOT
  // simply re-pin the constant — that is the silent migration this guards.
  assert.equal(samplerStamp(), SAMPLER,
    'the anchor sampler has changed; index-keyed saves can no longer be moved by position');
});

test("a piranesi/3 save's torches land on the same brackets — BACKLOG 0w", () => {
  const { cat, id, def } = anchored();

  // The modern way: choices named by WHERE THEY ARE.
  const now = new World(cat);
  now.place(0, 0, 0, id);
  const modern = survey(now, cat);
  for (const s of modern) now.setAnchorKind(s.id, 'torch');
  const file = now.toJSON();
  assert.equal(file.format, 'piranesi/4');
  assert.ok(file.anchors.every(([k]) => !isIndexKey(k)), 'and nothing is keyed by an index any more');

  // The same choices as a `piranesi/3` file would have written them.
  const legacy = {
    format: 'piranesi/3', palette: file.palette, cells: file.cells,
    anchors: def.anchors.map((_, i) => [`structure|0,0,0#${i}`, 'torch']),
  };
  const back = World.fromJSON(cat, legacy, (r) => blockFromRecipe(r));
  assert.equal(back.indexed, def.anchors.length, 'the loader notices they are the old kind');

  // THE CLAIM IS PHYSICAL: the same brackets are lit, in world coordinates.
  // Comparing the keys would only prove the migration agrees with itself.
  const after = survey(back, cat);
  assert.ok(lit(after).length, 'something is lit at all');
  assert.deepEqual(lit(after), lit(survey(now, cat)));
  assert.match(back.anchorNote, /moved to the new naming/);
  assert.equal(back.indexed, 0, 'and it is not attempted twice');

  // AND IT STAYS MOVED. The upgrade is only worth anything if the /4 file it
  // produces reads back as itself — the failure this whole item is about is a
  // torch that quietly walks one save at a time.
  const saved = back.toJSON();
  assert.equal(saved.format, 'piranesi/4');
  assert.ok(saved.anchors.every(([k]) => !isIndexKey(k)));
  const again = World.fromJSON(cat, saved, (r) => blockFromRecipe(r));
  assert.equal(again.indexed, 0, 'nothing left for the upgrade to do');
  assert.deepEqual(lit(survey(again, cat)), lit(after), 'the same brackets, a second time round');
});

test("a choice on a block this build cannot make is LEFT ALONE — BACKLOG 0w", () => {
  // The upgrade drops a key naming a site the block no longer offers, which is
  // right. It must not do the same to a key whose block is missing because THIS
  // BUILD CANNOT DECODE ITS RECIPE — that is a lossy load, the block may come
  // back the day the grammar does, and it should come back with its torches on.
  // Same rule as the shelf's: report, keep, never delete.
  const { cat, id, def } = anchored();
  const w = World.fromJSON(cat, {
    format: 'piranesi/3', palette: [id, OLD_LADDER], cells: [[0, 0, 0, 0], [9, 0, 0, 1]],
    anchors: [
      ['structure|0,0,0#0', 'torch'],
      ['structure|9,0,0#0', 'ring'],       // …on the block that will not build
    ],
  }, (r) => blockFromRecipe(r));
  assert.deepEqual(w.missing, [OLD_LADDER], 'the lossy load is what sets this up');

  survey(w, cat);
  assert.equal(w.anchors.get('structure|9,0,0#0'), 'ring', 'kept, exactly as written');
  assert.equal(w.anchors.get(siteId({ layer: 'structure', x: 0, y: 0, z: 0 }, def.anchors[0])), 'torch');
  assert.match(w.anchorNote, /cannot build and were left alone/);

  // …and the file it would write says so: a stale index key means it is still a
  // /3 file, and stamping /4 over it would tell the next reader to take those
  // keys for geometry.
  assert.equal(w.toJSON().format, 'piranesi/3');
});

test('a site the block no longer has is dropped, and said — BACKLOG 0w', () => {
  const { cat, id } = anchored();
  const w = World.fromJSON(cat, {
    format: 'piranesi/3', palette: [id], cells: [[0, 0, 0, 0]],
    anchors: [['structure|0,0,0#99', 'ring']],
  }, (r) => blockFromRecipe(r));
  survey(w, cat);
  assert.equal(w.anchors.size, 0, 'guessing at it would put a ring on the wrong wall');
  assert.match(w.anchorNote, /no longer have/);
});

test('IF THE SAMPLER HAS MOVED, NOTHING IS REWRITTEN — BACKLOG 0w', () => {
  // The trap the handoff named: the obvious repair is to rewrite saved keys to
  // geometry at load time, and that is exact only while the sampler agrees with
  // the one that wrote them. A MIGRATION THAT SILENTLY MOVES EVERY TORCH IS
  // WORSE THAN AN INDEX THAT FAILS VISIBLY.
  const { cat, id, def } = anchored();
  const w = World.fromJSON(cat, {
    format: 'piranesi/3', palette: [id], cells: [[0, 0, 0, 0]],
    anchors: def.anchors.map((_, i) => [`structure|0,0,0#${i}`, 'torch']),
  }, (r) => blockFromRecipe(r));

  reindex(w, cat, 'some-other-sampler');
  assert.ok([...w.anchors.keys()].every(isIndexKey), 'the old keys are exactly where they were');
  assert.match(w.anchorNote, /sampler has changed/);
  assert.equal(lit(survey(w, cat)).length, 0, 'nothing is lit, which is the visible failure');
});

test('a turned block keeps its torches on the wall they were bolted to', () => {
  // The name is the site's LOCAL declaration, before the placement turn —
  // `siteWorld` turns the point and the normal, not the name. Deriving it any
  // other way is how a turned block ends up with its torches on the wrong wall,
  // which looks entirely plausible until you turn the block back.
  const { cat, id, def } = anchored();
  const w = new World(cat);
  w.place(0, 0, 0, id, 0);
  const a = def.anchors[0];
  w.setAnchorKind(siteId({ layer: 'structure', x: 0, y: 0, z: 0 }, a), 'ring');
  const before = survey(w, cat).find((s) => s.kind === 'ring');
  assert.ok(before);

  w.place(0, 0, 0, id, 1);                        // the same cell, turned
  w.setAnchorKind(siteId({ layer: 'structure', x: 0, y: 0, z: 0 }, a), 'ring');
  const after = survey(w, cat).find((s) => s.kind === 'ring');
  assert.equal(after.side, ['+x', '+y', '-x', '-y'][(['+x', '+y', '-x', '-y'].indexOf(a.side) + 1) % 4],
    'the site moved round with the block…');
  assert.equal(after.id, before.id, '…and is still called the same thing');
});

test('the committed corpus of old saves still comes across', () => {
  // The handoff's own precondition for touching this at all: "whatever is done
  // here needs a way to check itself against a committed corpus of saves first
  // — of which there is currently one, and it has no anchors set."
  const cat = buildCatalog(24, 1);
  for (const [file, gen] of [['docs/sample-save.json', 3], ['docs/sample-anchors.json', 3]]) {
    const data = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    assert.equal(data.format, `piranesi/${gen}`, `${file} is kept AS an old file, on purpose`);
    const w = World.fromJSON(cat, data, (r) => blockFromRecipe(r));
    assert.deepEqual(w.missing, [], `${file}: every recipe in it still builds`);
    assert.ok(w.size > 0, `${file}: and it is not empty`);
    const sites = survey(w, cat);
    if (data.anchors && data.anchors.length) {
      assert.ok(data.anchors.every(([k]) => isIndexKey(k)), `${file}: the fixture IS index-keyed`);
      assert.equal(lit(sites).length + sites.filter((s) => s.kind === 'ring').length,
        data.anchors.length, `${file}: every choice found its bracket`);
    }
  }
});

test('the view rides in the file as a hint and changes nothing about the world — BACKLOG 0t', () => {
  const cat = buildCatalog(4, 1);
  const w = new World(cat);
  w.place(0, 0, 0, [...cat.keys()][0]);
  const view = { centre: [4, 4], layer: 2, yaw: 0.5, zoom: 1.5 };
  const f = buildingToFile('x', w.toJSON(), view);
  const got = readFile(f.body);
  assert.equal(got.kind, 'building');
  assert.deepEqual(got.view, view, 'it comes back out separately');
  assert.equal(hashOf(got.world), hashOf(w.toJSON()),
    'and it is NOT part of what the building is — you send somebody a building, not your camera');
  assert.equal(World.fromJSON(cat, got.world, (r) => blockFromRecipe(r)).size, 1);
  assert.equal(readFile(buildingToFile('x', w.toJSON()).body).view, null, 'and it is optional');
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
