// store.js — WHERE YOUR WORK LIVES, and the one place that knows.
//
//   "one big thing we need, a save feature so you can use these creations"
//
// Before this, persistence was three ad-hoc `localStorage` calls in two files
// with no format, no versioning, no way out of the browser, and room for exactly
// one building. Everything you made lived in one browser profile's storage and
// was one "clear site data" from gone.
//
// FOUR RULES, and they are the project's own, restated for saving.
//
// 1. THE RECIPE IS THE IDENTITY. A shelf is a list of recipe strings and
//    nothing else. Not indices, not names, not ids — those are all positions in
//    a list something regenerates, which is the bug `recipe.js` exists to kill.
//
// 2. THE NAMES ARE DERIVED. Never stored, never trusted, regenerated on read.
//    See `naming.js`: a name typed beside a recipe starts lying the moment
//    either changes, and a save full of lying labels is worse than one with
//    none.
//
// 3. THE FILE IS A FILE THIS REPO ALREADY READS. A shelf exports as one recipe
//    a line — which is what `docs/kit.txt` is and what
//    `tools/blockshot.mjs --recipes @file` eats — and a building exports as
//    `World.toJSON`, which is what `tools/plateshot.mjs --load` eats. No new
//    format, no converter, and the moment a save lands on disk every instrument
//    in the project can draw it. THAT is what "use these creations" means.
//
// 4. REPORT, NEVER SUBSTITUTE. A recipe this version cannot build, a file that
//    will not parse, a write that hits the quota: each of those is something
//    the player is TOLD. The silent version of any of them loses work.
//
// It takes its storage as an argument so the whole of it can be tested in node
// against a Map — a save system with no tests is a rumour.

import { decode } from './recipe.js';
import { shelfToText, shelfFromText, describe } from './naming.js';

/** Everything this project keeps, under one prefix. */
export const KEYS = {
  draft: 'piranesi/drawing',      // the board's working drawing, as a recipe
  shelf: 'piranesi/shelf',        // [recipe, …] — the blocks you kept
  buildings: 'piranesi/buildings', // [{ name, world, view }] — what you built
  open: 'piranesi/open',          // the name of the building currently open
};

/** The keys this replaces, kept so nobody's work is stranded by the upgrade. */
export const OLD = {
  drawn: 'piranesi/drawn',        // the first shelf: [recipe, …]
  save: 'piranesi/save',          // the one and only building
};

export const FORMAT = 'piranesi/3';   // World.toJSON's own marker

/* ------------------------------------------------------------- the store -- */

export class Store {
  /**
   * @param backing anything with getItem/setItem/removeItem — the real
   *   localStorage in a browser, a Map-backed shim in a test.
   *
   * NOT A DEFAULT PARAMETER. Reading `globalThis.localStorage` THROWS
   * SecurityError in Chrome with third-party cookies blocked, and a default
   * argument is evaluated before the body, so `|| memory()` on the next line
   * would never run. That turns "nothing can be saved" into "nothing loads" —
   * and the save system is the one component that has to survive hostile
   * storage, because it is the one that tells you storage is hostile.
   */
  constructor(backing) {
    let s = backing;
    if (!s) { try { s = globalThis.localStorage; } catch { s = null; } }
    this.s = s || memory();
    /** Every complaint since the last `drain()`. The pages show these; nothing
     *  in here ever throws at a caller who just wanted to save. */
    this.problems = [];
  }

  say(msg) { this.problems.push(msg); return msg; }
  drain() { const p = this.problems; this.problems = []; return p; }

  /**
   * THE ONLY PLACE THIS MODULE TOUCHES A KEY, and it is wrapped.
   *
   * Reading `globalThis.localStorage` throws SecurityError in Chrome with
   * third-party cookies blocked, and Safari in private mode throws on the
   * CALLS too, not merely on the property. A save system is the one component
   * that has to survive hostile storage, because it is the one that tells you
   * storage is hostile — so every read goes through here and none of them can
   * take the page down.
   */
  raw(key) { try { return this.s.getItem(key); } catch { return null; } }
  has(key) { return this.raw(key) != null; }

  get(key, fallback = null) {
    const raw = this.raw(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      // QUARANTINE, THEN REPORT — and this is the fix for the worst bug this
      // module ever had.
      //
      // It used to say "unreadable and was left untouched" and return the
      // fallback. Which was true of the READER. But the caller then got an
      // empty list, worked from it, and the next write put that empty list
      // straight over the top: one click and every building was gone, with a
      // reassuring message in the log saying nothing had been touched. The
      // invariant the comment claimed was "a key that will not read is never
      // written over"; the invariant the code had was "the reader does not
      // delete it", and those differ by exactly the bug.
      //
      // So the raw text is copied somewhere safe FIRST. After that the write
      // may proceed — refusing it would leave the player unable to save at all
      // until they went into devtools, which is worse.
      this.quarantine(key, raw);
      return fallback;
    }
  }

  /** Put the raw text of an unreadable value somewhere it cannot be trodden on.
   *  Never overwrites an existing quarantine: the FIRST copy is the good one. */
  quarantine(key, raw) {
    const box = `${key}~broken`;
    const already = this.raw(box);
    if (already == null) {
      try { this.s.setItem(box, raw); } catch { /* nothing more we can do */ }
    }
    this.say(`${key} would not read — the original is kept at "${box}"; export before you build on this`);
  }

  /**
   * Write, and say so if it fails.
   *
   * THE QUOTA IS THE FAILURE MODE THAT LOSES WORK. `localStorage` throws when
   * full, and the previous code caught it and carried on with an empty comment
   * — so the game would go on placing blocks, autosaving nothing, and the
   * player would find out on reload. It returns false now, and every caller
   * puts that on screen.
   */
  put(key, value) {
    try {
      this.s.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      this.say(`could not save: ${err && err.name === 'QuotaExceededError'
        ? 'this browser is out of storage — export to a file before you lose anything'
        : String(err)}`);
      return false;
    }
  }

  del(key) { try { this.s.removeItem(key); } catch { /* gone anyway */ } }

  /* ------------------------------------------------------------- the shelf */

  /** The blocks you kept. Recipes, in the order you added them; anything this
   *  version cannot build is reported and dropped from the WORKING list, but
   *  left in storage in case a later version can build it again. */
  blocks() {
    // ABSENT AND UNREADABLE ARE NOT THE SAME THING, and conflating them cost a
    // shelf: `get` returns its fallback for both, so `?? migrate()` fired on a
    // corrupt shelf and MIGRATION OVERWROTE IT with an empty list. A value that
    // will not parse is left exactly where it is — see `get`.
    const raw = !this.has(KEYS.shelf) ? this.migrateShelf() : this.get(KEYS.shelf, null);
    if (!Array.isArray(raw)) return [];
    const ok = [], bad = [];
    for (const r of raw) (typeof r === 'string' && decode(r).ok ? ok : bad).push(r);
    if (bad.length) this.say(`${bad.length} block(s) on the shelf cannot be built by this version: ${bad.join(', ')}`);
    return ok;
  }

  /** Put a block on the shelf. A recipe IS the block, so adding one twice is
   *  not a duplicate — it is the same block, and it says so. */
  addBlock(recipe) {
    const list = !this.has(KEYS.shelf)
      ? (this.migrateShelf() || []) : (this.get(KEYS.shelf, null) || []);
    if (!decode(recipe).ok) return { ok: false, why: decode(recipe).why };
    if (list.includes(recipe)) return { ok: false, why: 'already on the shelf — a recipe IS the block' };
    list.push(recipe);
    if (!this.put(KEYS.shelf, list)) return { ok: false, why: this.problems[this.problems.length - 1] };
    return { ok: true, name: describe(recipe)?.name, count: list.length };
  }

  removeBlock(recipe) {
    const list = this.get(KEYS.shelf, []) || [];
    const i = list.indexOf(recipe);
    if (i < 0) return false;
    list.splice(i, 1);
    return this.put(KEYS.shelf, list);
  }

  /**
   * WRITE THE SHELF WITHOUT DELETING WHAT YOU CANNOT SEE.
   *
   * `blocks()` filters out recipes this version cannot build and says they are
   * "left in storage in case a later version can build it again" — and then
   * `draw.js` did `state.shelf = store.blocks()` and wrote that filtered list
   * straight back. Every drawing made before the slice-plane ladder changed
   * would have been deleted by the first time anything touched the shelf, and
   * `draw.html` is the only place a `D:` recipe originates, so that shelf entry
   * is the last copy. The function that filters and the function that writes
   * have to agree about what the shelf IS.
   */
  setBlocks(list) {
    const stored = !this.has(KEYS.shelf) ? [] : (this.get(KEYS.shelf, []) || []);
    const keeping = new Set(list);
    const unbuildable = stored.filter((r) => typeof r === 'string' && !decode(r).ok && !keeping.has(r));
    if (unbuildable.length) {
      this.say(`${unbuildable.length} block(s) this version cannot build are still on the shelf, untouched`);
    }
    return this.put(KEYS.shelf, [...list, ...unbuildable]);
  }

  /* ------------------------------------------------------------- the draft */

  /**
   * The board's working drawing, stored BARE rather than as JSON — because it
   * always was, and because a recipe validates itself so there is nothing a
   * wrapper would add.
   *
   * Going through `put` would have JSON-quoted it, and then the next boot's
   * `JSON.parse` on the un-quoted legacy value would have thrown, quarantined
   * it and started from the default: everybody's in-progress drawing lost, once,
   * silently, on the upgrade.
   */
  draft() { return this.raw(KEYS.draft) || ''; }
  setDraft(recipe) {
    try { this.s.setItem(KEYS.draft, String(recipe)); return true; } catch (err) {
      this.say(`could not keep the drawing: ${err && err.name === 'QuotaExceededError'
        ? 'this browser is out of storage' : String(err)}`);
      return false;
    }
  }

  /* --------------------------------------------------------- the buildings */

  buildings() {
    // Absent vs unreadable, as in `blocks()` — a corrupt list is never replaced.
    const raw = !this.has(KEYS.buildings)
      ? this.migrateBuildings() : this.get(KEYS.buildings, null);
    return Array.isArray(raw) ? raw : [];
  }

  building(name) { return this.buildings().find((b) => b.name === name) || null; }

  /**
   * Save a building under a name. A name here IS typed by the player, because
   * unlike a block a building has no grammar to be read back out of — but it is
   * still only a label: what identifies a building is its cells and its
   * palette, and the palette holds recipes.
   */
  saveBuilding(name, world, view = null) {
    const list = this.buildings();
    const rec = { name, world, ...(view ? { view } : {}) };
    const i = list.findIndex((b) => b.name === name);
    if (i >= 0) list[i] = rec; else list.push(rec);
    if (!this.put(KEYS.buildings, list)) return false;
    this.put(KEYS.open, name);
    return true;
  }

  removeBuilding(name) {
    const list = this.buildings().filter((b) => b.name !== name);
    return this.put(KEYS.buildings, list);
  }

  renameBuilding(from, to) {
    const list = this.buildings();
    const b = list.find((x) => x.name === from);
    if (!b) return false;
    if (list.some((x) => x.name === to)) { this.say(`there is already a building called "${to}"`); return false; }
    b.name = to;
    if (this.get(KEYS.open) === from) this.put(KEYS.open, to);
    return this.put(KEYS.buildings, list);
  }

  openName() { return this.get(KEYS.open, null); }
  setOpen(name) { return this.put(KEYS.open, name); }

  /* ---------------------------------------------------------- the upgrade */

  /**
   * THE OLD KEYS, READ ONCE AND KEPT.
   *
   * Not deleted: an upgrade that throws away the thing it is upgrading has no
   * way back if it turns out to be wrong, and this is somebody's work. The old
   * keys are left exactly where they were, and the new ones win from here.
   */
  migrateShelf() {
    const old = this.get(OLD.drawn, null);
    const list = Array.isArray(old) ? old.filter((r) => typeof r === 'string') : [];
    if (list.length) this.say(`${list.length} block(s) brought across from the old shelf`);
    this.put(KEYS.shelf, list);
    return list;
  }

  migrateBuildings() {
    const out = [];
    // The old single save, plus any `?slot=` saves — the slot mechanism was the
    // only way to have two buildings, and it was a URL parameter nobody could
    // discover.
    let n = 0;
    try { n = this.s.length || 0; } catch { n = 0; }
    for (let i = 0; i < n; i++) {
      let k = null;
      try { k = this.s.key ? this.s.key(i) : null; } catch { k = null; }
      if (!k || !k.startsWith(OLD.save)) continue;
      const world = this.get(k, null);
      if (!world || !world.cells) continue;
      const slot = k.slice(OLD.save.length).replace(/^:/, '');
      out.push({ name: slot || 'the first building', world });
    }
    if (out.length) this.say(`${out.length} building(s) brought across from the old save`);
    this.put(KEYS.buildings, out);
    return out;
  }
}

/** A Map-backed stand-in, so `new Store()` works with no browser at all. */
function memory() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/* -------------------------------------------------------------- the files */

/**
 * A SHELF AS A FILE — one recipe a line, names in comments. `naming.js` owns the
 * text; this only names it. The extension is `.txt` because that is what it is,
 * and because `--recipes @file` will not look twice at it.
 */
export const blocksToFile = (recipes, title) => ({
  name: `piranesi-blocks-${recipes.length}.txt`,
  type: 'text/plain',
  body: shelfToText(recipes, title || `${recipes.length} blocks`),
});

/** A BUILDING AS A FILE — `World.toJSON` unchanged, so `plateshot --load` can
 *  pull a full plate of it without knowing this module exists. */
export const buildingToFile = (name, world) => ({
  name: `piranesi-${slug(name)}.json`,
  type: 'application/json',
  body: buildingText(world),
});

/**
 * ONE LINE PER BLOCK, and it is not a formatting preference.
 *
 * `world.js` sorts the cells so that two identical buildings serialise to
 * identical text and A DIFF OF TWO SAVES IS A DIFF OF TWO BUILDINGS. Plain
 * `JSON.stringify(w, null, 1)` throws that away: it breaks every four-element
 * cell over six lines, so moving one block shows as thirty changed lines and
 * the property the sort exists to buy is gone.
 */
export function buildingText(world) {
  const cells = (world.cells || []).map((c) => `  ${JSON.stringify(c)}`).join(',\n');
  const palette = (world.palette || []).map((r) => `  ${JSON.stringify(r)}`).join(',\n');
  const out = [`{`, ` "format": ${JSON.stringify(world.format || FORMAT)},`,
    ` "palette": [\n${palette}\n ],`,
    ` "cells": [\n${cells}\n ]`];
  if (world.anchors && world.anchors.length) {
    out[out.length - 1] += ',';
    out.push(` "anchors": [\n${world.anchors.map((a) => `  ${JSON.stringify(a)}`).join(',\n')}\n ]`);
  }
  out.push('}');
  return out.join('\n') + '\n';
}

export const slug = (s) => String(s || 'building').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'building';

/**
 * READ WHATEVER THE PLAYER PICKED, and work out what it was.
 *
 * Sniffed rather than trusted to the extension, because a file that has been
 * renamed is still the file it was. A building is JSON with cells; anything
 * else is tried as a shelf; and something that is neither says so rather than
 * importing nothing and looking like it worked.
 */
export function readFile(text) {
  const s = String(text);
  const trimmed = s.trim();
  if (trimmed.startsWith('{')) {
    let data;
    try { data = JSON.parse(trimmed); } catch (err) { return { kind: 'bad', why: `that file is not readable JSON (${err.message})` }; }
    if (!Array.isArray(data.cells)) return { kind: 'bad', why: 'that JSON is not a Piranesi building — no cells in it' };

    // THE FORMAT MARKER IS READ. It was written on every save since
    // `piranesi/3` and looked at by nothing, so a file from a later version
    // would be parsed by this one's reader, quietly, and written back
    // downgraded. Refusing a newer major is the whole reason to stamp a file.
    const gen = Number(String(data.format || '').split('/')[1]);
    if (Number.isFinite(gen) && gen > 3) {
      return { kind: 'bad', why: `that file is ${data.format} and this build reads ${FORMAT} — it needs a newer Piranesi` };
    }

    // AND THE ROWS ARE CHECKED, not just the array. `World.fromJSON`
    // destructures every cell (`for (const [x,y,z,ref,rot] of data.cells`), so
    // one non-iterable row throws a TypeError — and the game SAVES an imported
    // building before it opens it, so the throw came back on every subsequent
    // boot with no UI left to undo it. A bad file bricked the page for good.
    for (let i = 0; i < data.cells.length; i++) {
      const c = data.cells[i];
      if (!Array.isArray(c) || c.length < 4 || c.slice(0, 4).some((n) => !Number.isFinite(n))) {
        return { kind: 'bad', why: `that file's cell ${i} is not [x,y,z,block] — it is ${JSON.stringify(c)}` };
      }
    }
    if (data.palette && !data.palette.every((r) => typeof r === 'string')) {
      return { kind: 'bad', why: "that file's palette is not a list of recipes" };
    }
    if (!Array.isArray(data.palette)) return { kind: 'building', world: data, note: 'an older save with no palette' };
    return { kind: 'building', world: data };
  }
  const { recipes, bad } = shelfFromText(s);
  // NO GOOD RECIPES IS A BAD FILE, not an import of nothing. `hello world` is
  // two unbuildable tokens, and reporting that as "imported 0 blocks" is the
  // shape of failure this module exists to refuse.
  if (!recipes.length) {
    return { kind: 'bad', why: bad.length
      ? `nothing in that file is a recipe this version can build (${bad.length} line(s) tried)`
      : 'there are no recipes in that file' };
  }
  return { kind: 'blocks', recipes, bad };
}
