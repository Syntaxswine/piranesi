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
  /** @param backing anything with getItem/setItem/removeItem — the real
   *   localStorage in a browser, a Map-backed shim in a test. */
  constructor(backing = globalThis.localStorage) {
    this.s = backing || memory();
    /** Every complaint since the last `drain()`. The pages show these; nothing
     *  in here ever throws at a caller who just wanted to save. */
    this.problems = [];
  }

  say(msg) { this.problems.push(msg); return msg; }
  drain() { const p = this.problems; this.problems = []; return p; }

  get(key, fallback = null) {
    try {
      const raw = this.s.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      // A corrupt value is REPORTED and left alone. Deleting it would be the
      // one irreversible thing this module could do, on the one occasion it has
      // the least idea what is going on.
      this.say(`${key} is unreadable and was left untouched`);
      return fallback;
    }
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
    const raw = this.s.getItem(KEYS.shelf) == null ? this.migrateShelf() : this.get(KEYS.shelf, null);
    if (!Array.isArray(raw)) return [];
    const ok = [], bad = [];
    for (const r of raw) (typeof r === 'string' && decode(r).ok ? ok : bad).push(r);
    if (bad.length) this.say(`${bad.length} block(s) on the shelf cannot be built by this version: ${bad.join(', ')}`);
    return ok;
  }

  /** Put a block on the shelf. A recipe IS the block, so adding one twice is
   *  not a duplicate — it is the same block, and it says so. */
  addBlock(recipe) {
    const list = this.s.getItem(KEYS.shelf) == null
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

  setBlocks(list) { return this.put(KEYS.shelf, list); }

  /* --------------------------------------------------------- the buildings */

  buildings() {
    // Absent vs unreadable, as in `blocks()` — a corrupt list is never replaced.
    const raw = this.s.getItem(KEYS.buildings) == null
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
    for (let i = 0; i < (this.s.length || 0); i++) {
      const k = this.s.key ? this.s.key(i) : null;
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
    if (Array.isArray(data.cells) && Array.isArray(data.palette)) return { kind: 'building', world: data };
    if (Array.isArray(data.cells)) return { kind: 'building', world: data, note: 'an older save with no palette' };
    return { kind: 'bad', why: 'that JSON is not a Piranesi building — no cells in it' };
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
