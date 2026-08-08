// game.js — the shell: two modes, a stack of layers, and a drawing board.
//
// THREE THINGS IN HERE ARE LOAD-BEARING AND NONE OF THEM IS THE UI.
//
// 1. THE CANVAS IS SIZED BY A ResizeObserver, NEVER BY A BOOT-TIME MEASUREMENT.
//    The previous build measured `#stage` once at module load, got 28×320 out of
//    a layout that had not settled, and drew the whole game into a strip the
//    width of a finger.  The owner opened it and saw "a small beige square on a
//    black background", which is exactly what that is.  I had seen the same
//    symptom myself, resized the pane to make it go away, and shipped it.  An
//    observer cannot be early, and it also handles the window changing later.
//
// 2. THE PLATE IS BITTEN; THE BOARD IS DRAWN.  Everything the engraver makes
//    goes into an offscreen canvas and is only remade when the building or the
//    view changes.  The grid, the cursor and the layer marks are 2-D chrome
//    drawn over it on every mouse move.  So hovering costs a dozen lines instead
//    of a re-render — the owner flagged re-render time on the first build, and
//    hover was most of it.
//
// 3. TWO ENGRAVERS, NOT ONE.  A small one for while you are moving and a full
//    one for when you stop.  Same camera, same world; the draft just has fewer
//    pixels and no hatching.

import { World } from './world.js';
import { buildCatalog, blockFromRecipe, add } from './stack.js';
import { Store, buildingToFile, readFile } from './store.js';
import { download, pickFile } from './files.js';
import { describe } from './naming.js';
import { SUB } from './cube.js';
import { survey, fittingAt, KINDS } from './anchors.js';
import { Camera, projectWith } from './math.js';
import { Engraver } from './engrave.js';
import {
  LAYER, BUILD, EXPLORE, bandFor, buildCamera, exploreCamera,
  standingOn, pickCell, boardLines, cellOutline,
} from './build.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#plate');
const ctx = canvas.getContext('2d');
const stage = $('#stage');

const DRAFT = 0.42;
/** `?slot=` was the only way to have a second building, and it was a URL
 *  parameter nobody could discover. Kept as a way to OPEN one by name. */
const SLOT = new URLSearchParams(location.search).get('slot') || '';

const store = new Store();
const catalog = buildCatalog(24, 1);
drawnShelf(catalog);
const ids = [...catalog.keys()];

/**
 * THE BLOCKS THE PLAYER DREW, dealt beside the generated hand.
 *
 * `draw.html` keeps them; the game reads them.  A one-way channel on purpose —
 * the board owns the list — so a bug in either cannot corrupt the other's state,
 * and a building that uses a drawn block is safe regardless: its save carries
 * the recipe, and `World.fromJSON` registers anything the shelf has never heard
 * of.  Take a block off the shelf and every building made with it still loads.
 *
 * Reported and never substituted: a drawing this version cannot build says so
 * rather than leaving a silent gap.
 */
function drawnShelf(cat) {
  for (const r of store.blocks()) if (!add(cat, r) && !cat.has(r)) console.warn(`piranesi: cannot build ${r}`);
  for (const p of store.drain()) console.warn('piranesi:', p);
}

const state = {
  mode: BUILD,
  world: new World(catalog),
  layer: 0,
  yaw: 48 * Math.PI / 180,
  zoom: 1,
  centre: [LAYER / 2, LAYER / 2],
  rot: 0,
  pick: ids[0],
  hover: null,                       // [gx, gy] on the working layer
  eye: [-LAYER * 1.2, -LAYER * 1.2, standingOn(0)],
  eyeYaw: 45 * Math.PI / 180,
  shift: 0.27,
  dirty: true,
  quality: 'proof',
  settleAt: 0,
  stats: null,
  /** Anchor sites, resurveyed whenever the building changes.  See anchors.js. */
  sites: [],
  sitesAt: -1,
  picking: null,                     // the site whose menu is open
  /** How many blocks the open building lost on load. Non-zero blocks the save. */
  lossy: 0,
  /** The name of the building being worked on. The autosave writes into it. */
  open: '',
};

const camera = new Camera({});
const full = new Engraver({ width: 900, height: 640, ss: 2 });
const draft = new Engraver({ width: 380, height: 270, ss: 1 });

/** The developed plate, kept so the board can be redrawn over it for free. */
const sheet = document.createElement('canvas');
const sheetCtx = sheet.getContext('2d');

/* -------------------------------------------------------------- the size -- */

let sized = false;
new ResizeObserver(() => fit()).observe(stage);
addEventListener('load', fit);

function fit() {
  const r = stage.getBoundingClientRect();
  const w = Math.max(240, Math.floor(r.width) - 24);
  const h = Math.max(180, Math.floor(r.height) - 24);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  sheet.width = w; sheet.height = h;
  full.resize(w, h);
  draft.resize(Math.max(120, Math.round(w * DRAFT)), Math.max(90, Math.round(h * DRAFT)));
  sized = true;
  invalidate(0);
}

function invalidate(settle = 240) {
  state.dirty = true;
  state.quality = settle > 0 ? 'proof' : state.quality;
  state.settleAt = performance.now() + settle;
}

/* ------------------------------------------------------------ the camera -- */

function aim(width, height) {
  if (state.mode === BUILD) {
    return buildCamera(camera, {
      centre: state.centre, layer: state.layer, yaw: state.yaw,
      zoom: state.zoom, width, height,
    });
  }
  return exploreCamera(camera, {
    eye: state.eye, yaw: state.eyeYaw, shift: height * state.shift, width, height,
  });
}

/* ----------------------------------------------------------------- drawing */

/**
 * Bite the plate, now, synchronously.
 *
 * SEPARATE FROM THE FRAME LOOP ON PURPOSE.  requestAnimationFrame does not fire
 * in a hidden tab, and the browser preview runs hidden — so a test that changes
 * the layer, waits, and reads the stats gets the STALE numbers from whenever the
 * tab was last in front, identical for every layer, and reads exactly like a
 * broken layer switch.  I lost a round to that.  Anything that has to be
 * verified must be callable, not only schedulable.
 */
/**
 * Resurvey the anchor sites, but only when the building has actually changed.
 *
 * Whole-sweep rather than incremental, and cheap enough to be: placing a block
 * can bury or expose sites on any neighbour, removing one can expose sites two
 * blocks away through a bore, and an incremental update that is wrong leaves a
 * torch burning inside a wall with nothing to say so.
 */
function resurvey() {
  if (state.sitesAt === state.world.revision) return;
  state.sites = survey(state.world, catalog);
  state.sitesAt = state.world.revision;
  state.fittings = state.sites
    .filter((s) => s.viable && s.kind && s.kind !== 'none')
    .map((s) => {
      const m = fittingAt(s);
      return m && {
        x: 0, y: 0, z: 0, rot: 0, size: [1, 1, 1], mesh: m,
        seedAt: s.p.map(Math.round), layer: 'fitting',
      };
    })
    .filter(Boolean);
}

function bite(quality = state.quality) {
  if (!sized) return null;
  resurvey();
  const eng = quality === 'plate' ? full : draft;
  aim(eng.width, eng.height);
  state.stats = eng.render(state.world, camera, catalog, {
    hatching: eng === full,
    coursing: eng === full,
    lines: true,
    extra: state.fittings,
    // In explore mode you are INSIDE the building and every layer is real
    // stone.  Banding is a property of the drawing board, not of the world.
    bandOf: state.mode === BUILD ? bandFor(state.layer) : null,
  });
  paste(eng.plate.develop({ warmth: eng.warmth, grain: eng === full ? 1 : 0.4 }));
  state.dirty = false;
  hud();
  // The camera the board draws against must be the one the plate was drawn
  // with, or the grid slides off the blocks while a proof is up.
  aim(canvas.width, canvas.height);
  present();
  return state.stats;
}

function frame() {
  const t = performance.now();
  if (state.dirty) bite();
  if (state.quality === 'proof' && t >= state.settleAt) {
    state.quality = 'plate';
    state.dirty = true;
  } else if (!state.dirty) present();
  requestAnimationFrame(frame);
}

let buf = null;
function paste(img) {
  if (img.width === sheet.width && img.height === sheet.height) {
    if (!buf || buf.width !== img.width || buf.height !== img.height) {
      buf = sheetCtx.createImageData(img.width, img.height);
    }
    buf.data.set(img.data);
    sheetCtx.putImageData(buf, 0, 0);
  } else {
    const tmp = document.createElement('canvas');
    tmp.width = img.width; tmp.height = img.height;
    const t2 = tmp.getContext('2d');
    const d = t2.createImageData(img.width, img.height);
    d.data.set(img.data);
    t2.putImageData(d, 0, 0);
    sheetCtx.imageSmoothingEnabled = true;               // a soft proof reads as
    sheetCtx.drawImage(tmp, 0, 0, sheet.width, sheet.height);  // a proof
  }
}

function present() {
  ctx.drawImage(sheet, 0, 0);
  if (state.mode === BUILD) board();
  markers();
}

/**
 * THE RED CUBES.  "start them off as a red cube that can be clicked on to
 * select, none, torch, ring."
 *
 * Chrome, not geometry, and that is the whole design.  An unset anchor is a
 * question the editor is asking, so it must be crisp at any zoom, must be
 * clickable, and must not cost a re-bite of the plate when the mouse moves.
 * The moment the player answers, it stops being a question and becomes a ring
 * or a torch bitten into the plate like any other stone.
 *
 * DEPTH-TESTED AGAINST THE STENCIL, so a wall in front of it hides it — which
 * is the same rule as viability, applied to the eye instead of to the lattice.
 */
function markers() {
  const eng = state.quality === 'plate' ? full : draft;
  const depth = eng.depth;
  // The camera is aimed at the CANVAS, so a projection comes back in canvas
  // pixels; the stencil is the engraver's, which may be a fraction of that.
  const k = eng.width / canvas.width;
  const c = camera.snapshot();
  hits.length = 0;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const s of state.sites) {
    if (!s.viable || (s.kind && s.kind !== 'none')) continue;
    const q = projectWith(c, s.p[0], s.p[1], s.p[2]);
    if (q[2] <= 0) continue;
    // Test the depth a little way OUT of the wall, or the marker occludes
    // itself against the very face it is bolted to.
    const t = projectWith(c, s.p[0] + s.n[0] * 0.6, s.p[1] + s.n[1] * 0.6, s.p[2]);
    if (!depth.visible(t[0] * k, t[1] * k, t[2])) continue;
    const r = 5;
    hits.push({ site: s, x: q[0], y: q[1], r: r + 4 });
    ctx.fillStyle = state.picking === s ? 'rgba(206, 74, 44, 0.96)' : 'rgba(176, 46, 26, 0.80)';
    ctx.strokeStyle = 'rgba(28, 18, 14, 0.85)';
    ctx.lineWidth = 1;
    ctx.fillRect(q[0] - r, q[1] - r, r * 2, r * 2);
    ctx.strokeRect(q[0] - r + 0.5, q[1] - r + 0.5, r * 2 - 1, r * 2 - 1);
  }
  ctx.restore();
}

/** Screen-space hit boxes for the markers, rebuilt every time they are drawn.
 *  Picking a marker is a screen-space question — the player is aiming at a
 *  square on the glass, not at a point in the world. */
const hits = [];

function markerAt(x, y) {
  let best = null, bd = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d <= h.r && d < bd) { bd = d; best = h.site; }
  }
  return best;
}

/**
 * The drawing board: the working layer's grid, and the cell under the pointer.
 * Deliberately thin, cool and unassertive — this is the pencil under the
 * drawing, and the moment it competes with the plate the game stops being about
 * the building.
 */
function board() {
  ctx.save();
  // MULTIPLY, so the grid is ink and not paint.  Drawn normally it rules lines
  // straight across the building and the model reads as a photograph with graph
  // paper taped over it; multiplied, it shows on bare ground, fades on the
  // hatching and disappears entirely in the darks — which is exactly where a
  // draughtsman's setting-out lines go.
  ctx.globalCompositeOperation = 'multiply';
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(96, 102, 112, 0.34)';
  ctx.beginPath();
  for (const [ax, ay, bx, by] of boardLines(camera, state.layer, 7, state.centre)) {
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  }
  ctx.stroke();

  if (state.hover) {
    const [gx, gy] = state.hover;
    const base = cellOutline(camera, gx, gy, state.layer);
    const top = cellOutline(camera, gx, gy, state.layer, LAYER);
    if (base) {
      // The cursor is the one thing allowed to sit ON TOP of the drawing.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(150, 58, 38, 0.13)';
      ctx.strokeStyle = 'rgba(150, 58, 38, 0.85)';
      ctx.lineWidth = 1.4;
      ring(base, true);
      // The footprint is where it lands; the box is how tall it will be.  A
      // footprint alone reads as a floor tile and you place blindly.
      if (top) {
        ctx.globalAlpha = 0.45;
        ring(top, false);
        ctx.beginPath();
        for (let i = 0; i < 4; i++) { ctx.moveTo(base[i][0], base[i][1]); ctx.lineTo(top[i][0], top[i][1]); }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}

function ring(p, fill) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

/* ------------------------------------------------------------------ input -- */

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (drag) {
    const dx = sx - drag.x, dy = sy - drag.y;
    drag.x = sx; drag.y = sy;
    if (state.mode === BUILD) {
      state.yaw += dx * 0.008;
      state.zoom = clamp(state.zoom * (1 - dy * 0.004), 0.25, 4);
    } else {
      state.eyeYaw += dx * 0.005;
      state.shift = clamp(state.shift - dy * 0.0012, -0.15, 0.55);
    }
    invalidate();
    return;
  }
  if (state.mode !== BUILD) return;
  const c = pickCell(camera, sx, sy, state.layer);
  const same = c && state.hover && c[0] === state.hover[0] && c[1] === state.hover[1];
  state.hover = c;
  if (!same) hud();                    // the plate is untouched — chrome only
});

canvas.addEventListener('pointerleave', () => { state.hover = null; });

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  // Middle button, or any drag in explore mode, turns the view.  The left
  // button in build mode must stay a pure "place here" or building becomes a
  // negotiation with the camera.
  if (e.button === 1 || state.mode === EXPLORE) {
    drag = { x: sx, y: sy };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (state.mode !== BUILD) return;

  // A MARKER BEATS A PLACEMENT.  An anchor sits on a wall you can also build
  // against, so if the two ever compete the click has to go to the smaller,
  // more deliberate target — you do not hit a five-pixel red square by accident.
  const m = markerAt(sx, sy);
  if (m && e.button !== 2) { openPicker(m, sx, sy); return; }
  closePicker();

  const c = pickCell(camera, sx, sy, state.layer);
  if (!c) return;
  const [gx, gy] = c;
  if (e.button === 2) state.world.remove(gx * LAYER, gy * LAYER, state.layer * LAYER);
  else state.world.place(gx * LAYER, gy * LAYER, state.layer * LAYER, state.pick, state.rot);
  save();
  invalidate();
});

addEventListener('pointerup', (e) => {
  if (drag) { drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* gone */ } }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey || state.mode === EXPLORE) {
    state.zoom = clamp(state.zoom * (e.deltaY > 0 ? 0.9 : 1.11), 0.25, 4);
  } else {
    // THE SCROLL WHEEL CHANGES THE LAYER.  Asked for by name, and it is the
    // right default: in a layer builder the thing you change most is which
    // layer you are on, and zoom is the thing you set once.
    setLayer(state.layer + (e.deltaY > 0 ? -1 : 1));
  }
  invalidate();
}, { passive: false });

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key;
  const step = LAYER * (e.shiftKey ? 2 : 1);
  let hit = true;
  switch (k) {
    case 'PageUp': setLayer(state.layer + 1); break;
    case 'PageDown': setLayer(state.layer - 1); break;
    case 'Tab': setMode(state.mode === BUILD ? EXPLORE : BUILD); break;
    case 'r': case 'R': state.rot = (state.rot + 1) % 4; hud(); break;
    case 'q': case 'Q': if (state.mode === BUILD) state.yaw -= Math.PI / 12; else state.eye[2] += 1.5; break;
    case 'e': case 'E': if (state.mode === BUILD) state.yaw += Math.PI / 12; else state.eye[2] -= 1.5; break;
    case 'w': case 'W': case 'ArrowUp': move(0, step); break;
    case 's': case 'S': case 'ArrowDown': move(0, -step); break;
    case 'a': case 'A': case 'ArrowLeft': move(-step, 0); break;
    case 'd': case 'D': case 'ArrowRight': move(step, 0); break;
    default: hit = false;
  }
  if (k >= '1' && k <= '9') { choose(ids[(+k - 1) % ids.length]); hit = true; }
  if (hit) { e.preventDefault(); invalidate(); }
});

function move(right, fwd) {
  const { f, r } = camera.basis();
  if (state.mode === BUILD) {
    // Panning the board moves the WORKING PLANE under a fixed view, so the
    // three-quarter angle never changes while you travel.
    state.centre[0] += f[0] * fwd + r[0] * right;
    state.centre[1] += f[1] * fwd + r[1] * right;
  } else {
    const s = 0.55;
    state.eye[0] += (f[0] * fwd + r[0] * right) * s;
    state.eye[1] += (f[1] * fwd + r[1] * right) * s;
  }
}

function setLayer(L) {
  state.layer = Math.max(-4, Math.min(24, L));
  hud();
  invalidate();
}

function setMode(m) {
  state.mode = m;
  if (m === EXPLORE) {
    // Step into the space at the layer you were drawing, looking at the middle
    // of the board — so the mode switch answers "what does this look like from
    // inside?" and never dumps you in the dark somewhere else.
    state.eye = [state.centre[0] - LAYER * 1.6, state.centre[1] - LAYER * 1.6, standingOn(state.layer)];
    state.eyeYaw = Math.atan2(LAYER * 1.6, LAYER * 1.6);
    state.hover = null;
  }
  document.body.dataset.mode = m;
  $('#mode').textContent = m === BUILD ? 'build' : 'explore';
  hud();
  invalidate();
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* -------------------------------------------------------------- the picker */

/**
 * The little menu that turns a red cube into something.
 *
 * "start them off as a red cube that can be clicked on to select, none, torch,
 * ring.  there might be other options later" — so it is built from a LIST in
 * anchors.js rather than three hard-wired buttons, and adding an alcove or a
 * piece of wall art later is one entry there and no change here.
 */
function openPicker(site, sx, sy) {
  closePicker();
  state.picking = site;
  const el = document.createElement('div');
  el.id = 'picker';
  const r = canvas.getBoundingClientRect();
  el.style.left = `${r.left + sx + 10}px`;
  el.style.top = `${r.top + sy - 8}px`;
  for (const k of KINDS) {
    const b = document.createElement('button');
    b.className = 'kind' + (currentKind(site) === k.id ? ' on' : '');
    b.innerHTML = `<span>${k.name}</span><span class="note">${k.note}</span>`;
    b.onclick = (ev) => {
      ev.stopPropagation();
      state.world.setAnchorKind(site.id, k.id);
      save();
      closePicker();
      invalidate(0);
    };
    el.append(b);
  }
  document.body.append(el);
  present();
}

const currentKind = (s) => state.world.anchorKind(s.id) ?? 'none';

function closePicker() {
  const el = $('#picker');
  if (el) el.remove();
  state.picking = null;
}

addEventListener('pointerdown', (e) => {
  // Anywhere that is not the menu closes it.  The canvas handler runs first and
  // has already dealt with a click that landed on another marker.
  if (!state.picking) return;
  if (e.target.closest && e.target.closest('#picker')) return;
  if (e.target === canvas) return;
  closePicker();
  present();
}, true);

/* --------------------------------------------------------------- the shelf */

function shelf() {
  const box = $('#shelf');
  box.innerHTML = '';
  const byFamily = new Map();
  for (const d of catalog.values()) {
    if (!byFamily.has(d.family)) byFamily.set(d.family, []);
    byFamily.get(d.family).push(d);
  }
  for (const [fam, list] of byFamily) {
    const h = document.createElement('div');
    h.className = 'fam'; h.textContent = fam;
    box.append(h);
    for (const d of list) {
      const b = document.createElement('button');
      b.className = 'blk'; b.dataset.id = d.id;
      b.innerHTML = `<span>${d.name}</span><span class="sz">${d.family}</span>`;
      b.title = d.recipe;                       // the recipe IS the identity
      b.onclick = () => choose(d.id);
      box.append(b);
    }
  }
  choose(state.pick);
}

function choose(id) {
  state.pick = id;
  for (const b of document.querySelectorAll('.blk')) b.classList.toggle('on', b.dataset.id === id);
  hud();
}

function hud() {
  const s = state.stats;
  const d = catalog.get(state.pick);
  $('#layer').textContent = `layer ${state.layer}`;
  $('#rot').textContent = `turn ${state.rot * 90}°`;
  $('#recipe').textContent = d ? d.recipe : '';
  $('#hud').textContent =
    `${state.open} · ${state.world.size} block${state.world.size === 1 ? '' : 's'}` +
    (state.hover ? ` · at ${state.hover[0]},${state.hover[1]}` : '') +
    (s ? ` · ${s.visible} faces${s.ghosted ? ` (${s.ghosted} ghosted)` : ''}` +
      ` · ${s.hatchLines} strokes · ${s.ms.total.toFixed(0)} ms` : '') +
    (noted.length ? `\n${noted.join('\n')}` : '');
}

/* ---------------------------------------------------------------- the save */

/**
 * THE AUTOSAVE, which now has somewhere to go.
 *
 * It writes into the building that is OPEN. Before, there was one anonymous
 * slot and everything you built overwrote everything you had built; the only
 * second slot was a `?slot=` URL parameter nobody could discover. A quota
 * failure used to be swallowed by an empty catch — the game would carry on
 * placing blocks, saving none of them, and you found out on reload. It is
 * reported now, in the HUD, where you are looking.
 */
function save() {
  // A BUILDING THAT LOADED SHORT MUST NOT BE SAVED SHORT.
  //
  // `fromJSON` drops cells whose recipes this version cannot build, and the
  // palette is the ONE artefact that survives a grammar change — so writing the
  // world back would rebuild the palette from what SURVIVED and delete the
  // recipes for everything that did not. One click after opening a building
  // drawn before the slice-plane ladder changed and the evidence is gone,
  // permanently, and the file looks healthy ever after.
  if (state.lossy) {
    note(`"${state.open}" is missing ${state.lossy} block(s) this version cannot build — `
      + 'not saving over it. Use "save as" to keep this state under a new name.');
    return;
  }
  const view = { centre: state.centre.slice(), layer: state.layer, yaw: state.yaw, zoom: state.zoom };
  if (!store.saveBuilding(state.open, state.world.toJSON(), view)) {
    for (const p of store.drain()) note(p);
  }
  for (const p of store.drain()) note(p);
  buildings();
}

/** Open a building by name. A saved building brings its own blocks: `register`
 *  lets it put a recipe on the shelf this session's hand never dealt, which is
 *  the whole point of the palette. */
function openBuilding(name) {
  const rec = store.building(name);
  if (!rec) return false;
  const w = World.fromJSON(catalog, rec.world, (r) => blockFromRecipe(r));
  state.lossy = (w.missing && w.missing.length) || 0;
  if (state.lossy) {
    note(`${w.missing.length} block(s) in "${name}" cannot be built by this version — it will not be saved over`);
    console.warn('piranesi: cannot build:', w.missing);
  }
  if (w.displaced && w.displaced.length) {
    note(`${w.displaced.length} block(s) in "${name}" were on top of each other; the later one won`);
  }
  state.world = w;
  state.open = name;
  store.setOpen(name);
  if (rec.view) {
    state.centre = rec.view.centre ? rec.view.centre.slice() : state.centre;
    state.layer = rec.view.layer ?? state.layer;
    state.yaw = rec.view.yaw ?? state.yaw;
    state.zoom = rec.view.zoom ?? state.zoom;
  }
  buildings();
  setLayer(state.layer);
  invalidate(0);
  return true;
}

/**
 * A SUGGESTION, offered at the moment of naming and never afterwards.
 *
 * A BLOCK's name is derived and regenerated on every read, because a block has
 * a grammar to be read back out of (naming.js). A BUILDING does not: what it is
 * called is a label the player chooses, and the honest thing is to say so. The
 * first version derived this into `state.open` at boot and left it there, so a
 * building that started with one block was still called "1 blocks · 1×1×1" when
 * it had forty — a derived quantity that had quietly stopped deriving, which is
 * the bug this project keeps meeting. Now it only ever fills in a prompt.
 */
function suggestName(w = state.world) {
  const b = w.bounds();
  if (!b) return 'untitled';
  const storeys = Math.ceil((b.hi[2] - b.lo[2]) / LAYER);
  const across = Math.ceil((b.hi[0] - b.lo[0]) / LAYER);
  const deep = Math.ceil((b.hi[1] - b.lo[1]) / LAYER);
  return `${w.size} block${w.size === 1 ? '' : 's'} · ${across}×${deep}×${storeys}`;
}

function uniqueName(want) {
  const taken = new Set(store.buildings().map((b) => b.name));
  if (!taken.has(want)) return want;
  for (let i = 2; ; i++) if (!taken.has(`${want} (${i})`)) return `${want} (${i})`;
}

/* ------------------------------------------------------- the buildings list */

function buildings() {
  const box = $('#savelist');
  if (!box) return;
  const list = store.buildings();
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="none">Nothing saved yet.</div>';
    return;
  }
  for (const b of list) {
    const row = document.createElement('div');
    row.className = 'row2';
    const pick = document.createElement('button');
    pick.className = 'pick' + (b.name === state.open ? ' on' : '');
    pick.textContent = b.name;
    pick.title = `${(b.world.cells || []).length} cells · ${(b.world.palette || []).length} kinds of block`;
    pick.onclick = () => { openBuilding(b.name); note(`opened "${b.name}"`); };
    const x = document.createElement('button');
    x.className = 'drop';
    x.textContent = '×';
    x.title = 'delete this building';
    x.onclick = () => {
      if (!confirm(`Delete "${b.name}"? This cannot be undone.`)) return;
      store.removeBuilding(b.name);
      if (state.open === b.name) state.open = uniqueName('untitled');
      buildings();
      note(`deleted "${b.name}"`);
    };
    row.append(pick, x);
    box.append(row);
  }
}

/**
 * THE HUD'S MESSAGE LINE, and it is a QUEUE.
 *
 * It was one slot, and the drawer row handler is
 * `openBuilding(name); note('opened "x"')` — so a building that loaded short
 * reported the loss and then immediately overwrote its own damage report with
 * "opened". Every way of losing work here ends in "and then it was saved over",
 * and every one of those depends on the player not having been told.
 */
const noted = [];
function note(msg) {
  if (msg && noted[noted.length - 1] !== msg) noted.push(msg);
  while (noted.length > 3) noted.shift();
  hud();
}

/* ----------------------------------------------------------------- go ----- */

$('#mode').onclick = () => setMode(state.mode === BUILD ? EXPLORE : BUILD);
$('#clear').onclick = () => {
  if (!confirm('Clear the whole building?')) return;
  state.world = new World(catalog);
  save(); invalidate();
};

/* ------------------------------------------------------------ save, as files */

$('#saveas').onclick = () => {
  const want = prompt('Call this building what?', state.open || suggestName());
  if (want == null) return;
  const name = want.trim() || suggestName();
  if (store.building(name) && name !== state.open
    && !confirm(`"${name}" already exists. Overwrite it?`)) return;
  // Save-as is the escape hatch from a lossy load: you are deliberately keeping
  // THIS state, blocks-that-would-not-build and all, under a name of your own.
  state.open = name;
  state.lossy = 0;
  save();
  note(`saved as "${name}"`);
};

$('#newb').onclick = () => {
  if (state.world.size && !confirm('Start a new building? The one you are on is saved under its own name.')) return;
  save();                                       // keep what is there, then leave it
  state.world = new World(catalog);
  state.world.place(0, 0, 0, ids[0]);
  state.open = uniqueName('untitled');
  state.lossy = 0;
  save();
  note(`started "${state.open}"`);
  invalidate(0);
};

$('#exportb').onclick = () => {
  if (!state.world.size) return note('nothing built to export');
  const f = buildingToFile(state.open, state.world.toJSON());
  download(f);
  note(`${f.name} — draw it with: node tools/plateshot.mjs --load ${f.name}`);
};

$('#importb').onclick = async () => {
  const picked = await pickFile();
  if (!picked) return;
  if (picked.error) return note(picked.error);
  const got = readFile(picked.text);
  if (got.kind === 'bad') return note(got.why);
  if (got.kind === 'blocks') {
    // A shelf file opened in the game: put its blocks on the shelf rather than
    // refusing. It is obviously what was meant, and it costs nothing.
    let n = 0;
    for (const r of got.recipes) if (add(catalog, r)) n++;
    shelf();
    return note(`${n} block(s) added to the shelf${got.bad.length ? ` · ${got.bad.length} unbuildable` : ''}`);
  }
  // SAVED ONLY ONCE IT HAS OPENED. Writing first meant a file the loader chokes
  // on was already in storage, so it came back on every subsequent boot with no
  // UI left to remove it — one bad import bricked the page for good.
  const name = uniqueName(picked.name.replace(/\.json$/i, '') || 'imported');
  let w;
  try {
    w = World.fromJSON(catalog, got.world, (r) => blockFromRecipe(r));
  } catch (err) {
    return note(`that file will not load: ${err.message}`);
  }
  state.world = w;
  state.open = name;
  state.lossy = (w.missing && w.missing.length) || 0;
  store.saveBuilding(name, got.world);
  ids.length = 0; ids.push(...catalog.keys());
  shelf(); buildings(); invalidate(0);
  note(`opened "${name}" — ${w.size} block(s)`
    + (state.lossy ? ` · ${state.lossy} this version cannot build` : ''));
};

/**
 * ANOTHER TAB CHANGED THE SHELF.
 *
 * Drawing a block and then building with it is the normal way round, so the
 * board and the game are normally open at once — and `storage` fires in the
 * OTHER tabs. Without this you have to know to reload the game, which is
 * exactly the kind of thing nobody tells you.
 */
addEventListener('storage', (e) => {
  if (e.key !== 'piranesi/shelf') return;
  const before = catalog.size;
  drawnShelf(catalog);
  if (catalog.size !== before) {
    // APPENDED, never renumbered. `ids` is the number-key hand; rebuilding it
    // would silently change which block `3` places, mid-session, in a building
    // that is autosaving. Identity, never an index — the project's own law,
    // and the sync path was the one place the save feature broke it.
    for (const k of catalog.keys()) if (!ids.includes(k)) ids.push(k);
    shelf();
    note(`${catalog.size - before} block(s) arrived from the drawing board`);
  }
});

/* ----------------------------------------------------------------- go ----- */

{
  // Open the building that was open last, or the one named by `?slot=`, or the
  // first there is — and only make a new one if there is genuinely nothing.
  const first = store.buildings()[0];
  const want = SLOT || store.openName() || (first && first.name);
  for (const p of store.drain()) console.warn('piranesi:', p);
  if (!want || !openBuilding(want)) {
    state.world.place(0, 0, 0, ids[0]);         // never an empty promise
    state.open = uniqueName('untitled');
  }
  // THE SHELF IS BUILT AFTER THE BUILDING, and the order is the point. Opening
  // a building REGISTERS any recipe the catalogue lacks — that is what makes a
  // save self-contained — so a shelf rendered first would not list them. You
  // could see a block in your own building and have nothing to click to place
  // another one. Same reason `ids` is filled from the catalogue down here.
  ids.length = 0;
  ids.push(...catalog.keys());
  state.pick = state.pick && catalog.has(state.pick) ? state.pick : ids[0];
  shelf();
  buildings();
}
setMode(BUILD);
setLayer(state.layer);
fit();
requestAnimationFrame(frame);

// Handy from the console and from the browser instruments.
window.piranesi = {
  state, catalog, camera, full, draft, store,
  save, openBuilding, buildings, setLayer, setMode, bite, invalidate,
  describe,
};
void SUB;
