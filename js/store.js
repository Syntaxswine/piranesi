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
  index: 'piranesi/index',        // [{ name, slug }] — WHICH buildings, not what
  open: 'piranesi/open',          // the name of the building currently open
  tab: 'piranesi/tab',            // a counter, so each tab can mint its own token
};

/**
 * ONE KEY PER BUILDING, and it is a bug fix rather than tidiness.
 *
 * `piranesi/buildings` held the whole library in one value, so `setItem` had to
 * fit the entire array on every autosave. Once it did not fit, NOTHING could be
 * saved — including a brand-new building with one block in it — and the only
 * way out was devtools. It also meant one unreadable byte took the collection
 * down rather than one building.
 *
 * The slug is minted ONCE, when the building is first written, and never
 * changes. A rename moves the label, not the key: a rename that moved the key
 * would be a copy followed by a delete, and this module does not delete
 * somebody's work to accomplish a relabelling.
 */
export const bkey = (s) => `piranesi/building/${s}`;
export const BPREFIX = 'piranesi/building/';

/** The keys this replaces, kept so nobody's work is stranded by the upgrade. */
export const OLD = {
  drawn: 'piranesi/drawn',        // the first shelf: [recipe, …]
  save: 'piranesi/save',          // the one and only building
  buildings: 'piranesi/buildings', // the whole library in one value
};

/**
 * `piranesi/4`, and the bump is about ANCHORS.
 *
 * A /3 file keys its anchor choices by an INDEX into the block's generated list
 * of sites — the exact bug `recipe.js` exists to kill, one level down. A /4 file
 * keys them by geometry. An older build reading a /4 file would find no site
 * matching any key and quietly show a building with all its torches gone, so /4
 * is refused by the version check rather than half-read: see `readFile`, and
 * `anchors.js reindex` for the upgrade going the other way.
 */
export const FORMAT = 'piranesi/4';
/** The generations this build can read. A file older than this is upgraded and
 *  said so; a file newer is refused. */
export const READS = 4;

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
    /**
     * WHO THIS TAB IS, and it is the whole of the two-tab fix.
     *
     * `localStorage` is shared by every tab on the origin, and both of them boot
     * into `openName()` — so drawing a block in one tab and building in another
     * is the NORMAL workflow and a second game tab is one middle-click away.
     * Each held its own in-memory `World` and the autosave fired on every
     * placement, so one stray click in a stale tab wrote its old world over an
     * hour of building. Nothing needs locking; it only has to NOTICE.
     */
    this.session = this.newSession();
    /**
     * Writes so far this session. A TOKEN NAMES THE WRITE, NOT THE TAB, and the
     * distinction is the whole mechanism: with a per-tab token, tab A's second
     * save carried the same token as its first, so tab B — which had read
     * between them — still matched and was let through. It only refused when the
     * two tabs interleaved in one particular order, which is to say it refused
     * about half the time and looked like it worked.
     */
    this.writes = 0;
    /** slug → the token that was there when this tab last read or wrote it. A
     *  stored token that is not this one is somebody else's write. */
    this.held = new Map();
  }

  /** A name for one write: which tab, and which of its writes. */
  stamp() { return `${this.session}.${++this.writes}`; }

  /**
   * A name for this tab. `crypto.randomUUID` where there is one; a counter in
   * storage where there is not.
   *
   * NOT `Math.random`, and not because of the project's law about it — that law
   * is about the GENERATOR, where a block with a given seed has to be the same
   * block forever. A tab token is the opposite kind of thing: it must be
   * different every time, and the one property it needs is that two tabs never
   * agree by accident.
   */
  newSession() {
    try {
      const c = globalThis.crypto;
      if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 8);
    } catch { /* fall through */ }
    // No crypto: a counter, which is exact within one profile, plus the clock,
    // which covers two tabs racing on the read-modify-write of that counter.
    const n = (Number(this.raw(KEYS.tab)) || 0) + 1;
    try { this.s.setItem(KEYS.tab, String(n)); } catch { /* read-only storage */ }
    return `${n.toString(36)}-${Date.now().toString(36).slice(-4)}`;
  }

  /** Complain. BOUNDED, because not every caller drains: the buildings list
   *  reads every record and a corrupt one complains on every redraw, so an
   *  unread queue would grow for as long as the tab is open. */
  say(msg) {
    if (this.problems[this.problems.length - 1] !== msg) this.problems.push(msg);
    while (this.problems.length > 24) this.problems.shift();
    return msg;
  }
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

  /**
   * WHICH BUILDINGS THERE ARE — names and slugs, and deliberately nothing else.
   *
   * No cell counts, no sizes, no cached anything. A summary written down beside
   * the thing it summarises is a derived quantity that has stopped deriving,
   * which is the bug this project keeps meeting (`plan.js` §MASS, `naming.js`,
   * the building name that froze at boot). The list view reads the records.
   */
  index() {
    if (!this.has(KEYS.index)) {
      // Once per Store, or a failed migration would re-run and re-complain on
      // every read for the rest of the session.
      if (!this.mig) this.mig = this.migrateBuildings();
      return this.mig;
    }
    const raw = this.get(KEYS.index, null);
    let list = Array.isArray(raw)
      ? raw.filter((e) => e && typeof e.name === 'string' && typeof e.slug === 'string')
      : [];
    // AN ORPHANED RECORD IS STILL SOMEBODY'S WORK. If the index is lost, cut
    // short by a quota failure, or clobbered by an older build, the buildings
    // themselves are still sitting there under their own keys — so the index is
    // a convenience and never the authority.
    const stray = this.strays(new Set(list.map((e) => e.slug)));
    if (stray.length) {
      list = [...list, ...stray];
      // SAID ONCE. `index()` is on the path of every save, and if the repair
      // itself cannot be written — which is the case it most matters in — the
      // same complaint would come back on every click and push everything else
      // out of a three-line message queue.
      if (!this.healed) { this.say(`${stray.length} building(s) were not in the index and have been put back`); }
      this.healed = true;
      this.put(KEYS.index, list);
    }
    return list;
  }

  /** Building keys with no index entry, read back into entries. */
  strays(known) {
    const out = [];
    let n = 0;
    try { n = this.s.length || 0; } catch { n = 0; }
    for (let i = 0; i < n; i++) {
      let k = null;
      try { k = this.s.key ? this.s.key(i) : null; } catch { k = null; }
      if (!k || !k.startsWith(BPREFIX) || k.endsWith('~broken')) continue;
      const s = k.slice(BPREFIX.length);
      if (known.has(s)) continue;
      const rec = this.get(k, null);
      // A record that will not read has been quarantined by `get`; it keeps its
      // place in the index under its slug so the name is not lost as well.
      out.push({ name: (rec && typeof rec.name === 'string' && rec.name) || s, slug: s });
    }
    return out;
  }

  /** Every building, records and all. The expensive one — `summaries()` is what
   *  a list wants, and it is expensive too, but honestly so. */
  buildings() {
    return this.index().map((e) => this.record(e)).filter(Boolean);
  }

  /**
   * One building's record, by index entry. Null if the key is gone or corrupt —
   * both of which are reported rather than looking like an empty building.
   *
   * @param hold  "and I am now working on this one". ONLY the tab's open
   *   building may hold: `buildings()` reads every record to draw a list, and if
   *   reading counted as holding then merely listing the library would tell this
   *   tab it owned all of it — and the two-tab check would pass for a building
   *   this tab has never had on screen.
   */
  record(entry, hold = false) {
    const k = bkey(entry.slug);
    if (!this.has(k)) { this.say(`"${entry.name}" is in the index but its record is gone`); return null; }
    const rec = this.get(k, null);
    if (!rec || !rec.world) { this.say(`"${entry.name}" would not read`); return null; }
    if (hold) this.held.set(entry.slug, rec.token ?? null);
    // The index's name wins: a rename writes both, and if they ever disagree the
    // index is what the player has been looking at.
    return { ...rec, name: entry.name, slug: entry.slug };
  }

  /** What a list needs: enough to tell two similar buildings apart, and no
   *  world. See 0x — before this there was no timestamp and no content
   *  identity, so a library of near-copies could not be pruned safely. */
  summaries() {
    return this.index().map((e) => {
      const k = bkey(e.slug);
      const rec = this.has(k) ? this.get(k, null) : null;
      if (!rec || !rec.world) return { ...e, broken: true };
      return {
        ...e,
        at: rec.at || null,
        // RECOMPUTED, NEVER READ BACK. The record carries a `hash` and it would
        // be free to trust it — and it is a derived quantity written down beside
        // the thing it derives from, which is the bug this project keeps meeting
        // (`plan.js` §MASS, `naming.js`, the building name that froze at boot).
        // It drifted the first day it existed: widening the hash from thirteen
        // characters to fourteen left every stored value lying, and `sameAs`
        // would have stopped recognising every building already saved. The
        // stored one is kept only for `saveBuilding`'s is-this-a-no-op check,
        // where being wrong costs one unnecessary write.
        hash: hashOf(rec.world),
        cells: (rec.world.cells || []).length,
        kinds: (rec.world.palette || []).length,
        token: rec.token || null,
      };
    });
  }

  /** Look at a building. */
  building(name) {
    const e = this.index().find((x) => x.name === name);
    return e ? this.record(e) : null;
  }

  /** …and take it up: the same read, plus "this tab is now holding what it has
   *  just seen", which is what makes a later write by another tab a conflict. */
  open(name) {
    const e = this.index().find((x) => x.name === name);
    return e ? this.record(e, true) : null;
  }

  /** The slug for a name: the one it already has, or a fresh one that collides
   *  with nothing. Two names can slug alike (`a b` and `a-b`) and two buildings
   *  must never share a key. */
  slugFor(name) {
    const idx = this.index();
    const found = idx.find((e) => e.name === name);
    return found ? found.slug : freshSlug(name, new Set(idx.map((e) => e.slug)));
  }

  /**
   * Save a building under a name. A name here IS typed by the player, because
   * unlike a block a building has no grammar to be read back out of — but it is
   * still only a label: what identifies a building is its cells and its
   * palette, and the palette holds recipes.
   *
   * @returns { ok, why?, conflict?, unchanged? } — never a bare boolean, because
   *   "refused because another tab owns this" and "refused because the disk is
   *   full" want different words on screen and a different way out.
   */
  saveBuilding(name, world, view = null, opts = {}) {
    // ONE READ OF THE INDEX, taken before anything is written. Reading it again
    // after the record has landed would find that record as an orphan and repair
    // the index into containing it — which works, and complains about a "lost"
    // building on every single save of a new one.
    const idx = this.index();
    const found = idx.find((e) => e.name === name);
    const s = found ? found.slug : freshSlug(name, new Set(idx.map((e) => e.slug)));
    const k = bkey(s);
    const prior = this.has(k) ? this.get(k, null) : null;

    // 0u — SOMEBODY ELSE HAS WRITTEN HERE SINCE WE LAST LOOKED.
    //
    // `held` is what this tab last read or wrote at this slug. A stored token
    // that is neither means another tab owns the record, and the honest thing
    // is to write nothing: the loser of a last-click-wins race is always the tab
    // with the work in it. A record with no token at all is pre-upgrade and is
    // adopted rather than refused.
    if (prior && prior.token && this.held.get(s) !== prior.token && !opts.force) {
      this.say(`"${name}" was changed in another tab — nothing here has been saved`);
      return { ok: false, conflict: prior, why: 'another tab has written this building' };
    }

    const hash = hashOf(world);
    // AN IDENTICAL WRITE IS NOT A WRITE. The autosave fires on every click,
    // including the ones that change nothing (a right-click on empty air), and
    // a no-op that still bumps the clock makes the library's own history lie.
    if (prior && prior.hash === hash && sameView(prior.view, view)) {
      this.held.set(s, prior.token ?? null);
      return { ok: true, unchanged: true };
    }

    const token = this.stamp();
    const rec = {
      name, slug: s, world, ...(view ? { view } : {}),
      at: new Date().toISOString(), hash, token,
    };
    if (!this.put(k, rec)) return { ok: false, why: this.problems[this.problems.length - 1] };
    this.held.set(s, token);

    if (!found) {
      // THE RECORD IS WRITTEN FIRST AND THE INDEX SECOND, so a failure between
      // them leaves an orphan the next `index()` picks up — rather than an index
      // entry pointing at nothing.
      this.put(KEYS.index, [...idx, { name, slug: s }]);
    }
    this.put(KEYS.open, name);
    return { ok: true, hash, at: rec.at, slug: s };
  }

  /** "This tab wins." The only way past a conflict that keeps THIS world — the
   *  others are `save as` (a new name) and re-opening (theirs). */
  takeOver(name) {
    const s = this.slugFor(name);
    const rec = this.get(bkey(s), null);
    this.held.set(s, (rec && rec.token) ?? null);
    return true;
  }

  /** THE INDEX GOES FIRST HERE, and everywhere else the record does.
   *  Every other write wants a failure to leave an orphan the index can recover;
   *  a deletion wants a failure to leave the building ALIVE. Delete the record
   *  first and a failed index write leaves a name pointing at nothing. */
  removeBuilding(name) {
    const idx = this.index();
    const e = idx.find((x) => x.name === name);
    if (!e) return false;
    if (!this.put(KEYS.index, idx.filter((x) => x.slug !== e.slug))) return false;
    this.del(bkey(e.slug));
    this.held.delete(e.slug);
    return true;
  }

  renameBuilding(from, to) {
    const idx = this.index();
    const e = idx.find((x) => x.name === from);
    if (!e) return false;
    if (idx.some((x) => x.name === to)) { this.say(`there is already a building called "${to}"`); return false; }
    e.name = to;
    // The KEY does not move. The record's own copy of the name is updated so an
    // orphan recovered by `strays` comes back under the name it was last given.
    const rec = this.get(bkey(e.slug), null);
    if (rec) { rec.name = to; this.put(bkey(e.slug), rec); }
    if (this.get(KEYS.open) === from) this.put(KEYS.open, to);
    return this.put(KEYS.index, idx);
  }

  openName() { return this.get(KEYS.open, null); }
  setOpen(name) { return this.put(KEYS.open, name); }

  /** A building already here with this content, if there is one. Import asks,
   *  so re-importing a file you exported an hour ago is a recognised duplicate
   *  rather than a second entry nothing can tell from the first. */
  sameAs(world) {
    const h = hashOf(world);
    return this.summaries().find((b) => b.hash === h) || null;
  }

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

  /**
   * Two generations of library, in order of age, into one key each.
   *
   * ALL OR NOTHING ON THE INDEX. If any record fails to write — quota, most
   * likely, which is the very thing per-building keys exist to survive — the
   * index key is NOT written, so the next boot tries again and the old value is
   * still where it was. A half-written index that says migration is finished is
   * the one outcome that loses a building.
   */
  migrateBuildings() {
    const out = [];
    const taken = new Set();
    let failed = 0;
    const take = (name, world, view) => {
      if (!world || !Array.isArray(world.cells)) return;
      const s = freshSlug(name, taken);
      taken.add(s);
      const rec = { name, slug: s, world, ...(view ? { view } : {}), at: null, hash: hashOf(world) };
      if (this.put(bkey(s), rec)) out.push({ name, slug: s });
      else failed++;
    };

    // The one-key library, newest first in age order.
    const lib = this.has(OLD.buildings) ? this.get(OLD.buildings, null) : null;
    if (Array.isArray(lib)) for (const b of lib) if (b && typeof b.name === 'string') take(b.name, b.world, b.view);

    // …and before that, the old single save plus any `?slot=` saves — the slot
    // mechanism was the only way to have two buildings, and it was a URL
    // parameter nobody could discover.
    let n = 0;
    try { n = this.s.length || 0; } catch { n = 0; }
    const olds = [];
    for (let i = 0; i < n; i++) {
      let k = null;
      try { k = this.s.key ? this.s.key(i) : null; } catch { k = null; }
      if (k && k.startsWith(OLD.save)) olds.push(k);
    }
    for (const k of olds) {
      const world = this.get(k, null);
      if (!world || !world.cells) continue;
      const slot = k.slice(OLD.save.length).replace(/^:/, '');
      const name = slot || 'the first building';
      if (!out.some((e) => e.name === name)) take(name, world, null);
    }

    if (failed) {
      this.say(`${failed} building(s) could not be moved to the new store — the old copy is untouched and this will be tried again`);
      return out;
    }
    if (out.length) this.say(`${out.length} building(s) brought across from the old save`);
    this.put(KEYS.index, out);
    return out;
  }
}

/** A key nothing else is using. Two names can slug alike — `a b` and `a-b` —
 *  and two buildings sharing a key is one building with the other one gone. */
function freshSlug(name, taken) {
  const base = slug(name);
  let s = base;
  for (let i = 2; taken.has(s); i++) s = `${base}-${i}`;
  return s;
}

/* ------------------------------------------------------------- identity -- */

/**
 * WHAT THIS BUILDING IS, as sixty-four bits of its own canonical text.
 *
 * 0x: there was no timestamp and no content identity, so exporting a building,
 * building on for an hour and re-importing the older file gave you two entries
 * and no way to tell which was which. The cells are already sorted — that is
 * what `buildingText` is for — so the hash is nearly free and two identical
 * buildings hash alike however they were arrived at.
 *
 * TWO FNV RUNS, not one. Thirty-two bits is four billion, which sounds ample and
 * is not: the hash decides whether an import is a DUPLICATE of something already
 * here, and a false "you already have this" would hide a building.
 */
export function hashOf(world) {
  const t = buildingText(world);
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + 1 | 0;
  }
  // BOTH HALVES PADDED, AND NOT TRUNCATED. A 32-bit number is at most seven
  // characters in base 36, so padding each to seven makes the pair unambiguous
  // and the result a fixed fourteen. The first version padded only the second
  // half and then took the leading thirteen characters, which threw away five
  // bits of a hash whose whole job is to answer "is this the same building".
  const hex = (v) => (v >>> 0).toString(36).padStart(7, '0');
  return hex(a) + hex(b);
}

/** Whether a stored view and a fresh one are the same view, to the precision a
 *  player could tell. Used only to keep an unchanged save from being a write. */
function sameView(a, b) {
  if (!a || !b) return !a === !b;
  const near = (x, y) => Math.abs((x || 0) - (y || 0)) < 1e-6;
  return near(a.layer, b.layer) && near(a.yaw, b.yaw) && near(a.zoom, b.zoom)
    && near((a.centre || [])[0], (b.centre || [])[0])
    && near((a.centre || [])[1], (b.centre || [])[1]);
}

/** "4 minutes ago". Short, because it is a list of buildings and not a log. */
export function ago(iso, now = Date.now()) {
  if (!iso) return 'never saved';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  const steps = [[60, 'm', 60], [3600, 'h', 24], [86400, 'd', 7], [604800, 'w', 5], [2592000, 'mo', 12]];
  for (const [unit, tag, span] of steps) {
    const v = Math.floor(s / unit);
    if (v < span) return `${v}${tag} ago`;
  }
  return `${Math.floor(s / 31536000)}y ago`;
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
export const buildingToFile = (name, world, view = null) => ({
  name: `piranesi-${slug(name)}.json`,
  type: 'application/json',
  body: buildingText(world, view),
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
export function buildingText(world, view = null) {
  const cells = (world.cells || []).map((c) => `  ${JSON.stringify(c)}`).join(',\n');
  const palette = (world.palette || []).map((r) => `  ${JSON.stringify(r)}`).join(',\n');
  const out = [`{`, ` "format": ${JSON.stringify(world.format || FORMAT)},`,
    ` "palette": [\n${palette}\n ],`,
    ` "cells": [\n${cells}\n ]`];
  if (world.anchors && world.anchors.length) {
    out[out.length - 1] += ',';
    out.push(` "anchors": [\n${world.anchors.map((a) => `  ${JSON.stringify(a)}`).join(',\n')}\n ]`);
  }
  // 0t — A HINT, AND ONLY A HINT.
  //
  // You send somebody a building, not your camera, so `World.fromJSON` does not
  // read this and a building imported without it is not broken. But a big
  // building opening at the default view is disorienting to the point of looking
  // empty, and `plateshot --load` had no idea where to stand either. It goes
  // LAST and outside the world proper, so `hashOf` — which hashes the world's
  // own text — is untouched by where you happened to be looking.
  if (view) {
    out[out.length - 1] += ',';
    out.push(` "view": ${JSON.stringify(view)}`);
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
    if (Number.isFinite(gen) && gen > READS) {
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
    // The view rides out of the file separately, because it is not part of the
    // world and must not reach `World.fromJSON`.
    const view = data.view && typeof data.view === 'object' ? data.view : null;
    if (!Array.isArray(data.palette)) return { kind: 'building', world: data, view, note: 'an older save with no palette' };
    return { kind: 'building', world: data, view };
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
